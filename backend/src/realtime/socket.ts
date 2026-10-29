import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { prisma } from '../db.ts';
import { env } from '../config/env.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { loadSessionWithAccess } from '../services/permissions.ts';
import { getSnapshot } from '../modules/lecture-sessions/session.service.ts';
import { AppError, forbidden } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { randomUUID } from 'node:crypto';
import { attachIo, hub, rooms } from './hub.ts';
import { connectedCount, trackConnect, trackDisconnect } from './presence.ts';

/**
 * Client → server event contract. Payloads are validated; unknown fields are rejected.
 * Server → client events are documented in docs/REALTIME_EVENTS.md.
 */
export const clientEvents = {
  'session.subscribe': z.object({ sessionId: z.string().uuid() }).strict(),
  'session.unsubscribe': z.object({ sessionId: z.string().uuid() }).strict(),
  'session.request_snapshot': z.object({ sessionId: z.string().uuid() }).strict(),
} as const;

type Ack = (res: { ok: true } | { ok: false; code: string; message: string }) => void;
type SocketSession = { userId?: string };

const participantTimers = new Map<string, NodeJS.Timeout>();
function scheduleParticipantsBroadcast(sessionId: string) {
  if (participantTimers.has(sessionId)) return;
  participantTimers.set(
    sessionId,
    setTimeout(async () => {
      participantTimers.delete(sessionId);
      try {
        const joined = await prisma.attendanceRecord.count({ where: { sessionId, user: { role: 'STUDENT' } } });
        hub.toStaff(sessionId, 'participants.updated', { joined, connected: connectedCount(sessionId) });
      } catch (err) {
        logger.error({ err }, 'participants broadcast failed');
      }
    }, 500),
  );
}

/** Re-read the account from the database: a socket's cached identity is never trusted for sensitive actions. */
async function currentUserFor(socket: Socket): Promise<AuthUser> {
  const id = (socket.data.user as AuthUser | undefined)?.id;
  const user = id ? await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, displayName: true, role: true, isActive: true } }) : null;
  if (!user || !user.isActive) {
    socket.disconnect(true);
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

export function createSocketServer(httpServer: HttpServer, sessionMiddleware: RequestHandler) {
  const io = new Server(httpServer, {
    cors: { origin: env.FRONTEND_ORIGIN, credentials: true },
    maxHttpBufferSize: 8 * 1024,
    // Blocks cross-site WebSocket hijacking: browsers always send Origin, and it must be our frontend.
    allowRequest: (req, cb) => cb(null, !req.headers.origin || req.headers.origin === env.FRONTEND_ORIGIN),
  });
  attachIo(io);

  // Same cookie session as the REST API.
  io.engine.use(sessionMiddleware);
  io.use(async (socket, next) => {
    try {
      const req = socket.request as IncomingMessage & { session?: SocketSession };
      const userId = req.session?.userId;
      if (!userId) return next(new Error('UNAUTHENTICATED'));
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true, role: true, isActive: true } });
      if (!user || !user.isActive) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = { id: user.id, email: user.email, displayName: user.displayName, role: user.role } satisfies AuthUser;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    void socket.join(rooms.user(user.id));
    const subscribed = new Map<string, 'LECTURER' | 'STUDENT'>();

    // Per-socket event budget: 30 events / 10s; persistent abusers are disconnected.
    let windowStart = Date.now();
    let count = 0;
    let strikes = 0;
    const allowed = () => {
      const now = Date.now();
      if (now - windowStart > 10_000) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      if (count > 30) {
        strikes += 1;
        if (strikes > 5) socket.disconnect(true);
        return false;
      }
      return true;
    };

    const leave = (sessionId: string) => {
      const kind = subscribed.get(sessionId);
      if (!kind) return;
      subscribed.delete(sessionId);
      void socket.leave(kind === 'LECTURER' ? rooms.staff(sessionId) : rooms.students(sessionId));
      if (kind === 'STUDENT') {
        trackDisconnect(sessionId, user.id);
        scheduleParticipantsBroadcast(sessionId);
      }
    };

    const handle = <K extends keyof typeof clientEvents>(event: K, fn: (payload: z.infer<(typeof clientEvents)[K]>, current: AuthUser) => Promise<void>) => {
      const listener = async (raw: unknown, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
        try {
          if (!allowed()) throw new AppError(429, 'RATE_LIMITED', 'Too many events.');
          const payload = clientEvents[event].parse(raw) as z.infer<(typeof clientEvents)[K]>;
          await fn(payload, await currentUserFor(socket));
          reply({ ok: true });
        } catch (err) {
          const e = err instanceof z.ZodError ? new AppError(400, 'VALIDATION_ERROR', 'Invalid event payload.') : err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
          if (!(err instanceof AppError) && !(err instanceof z.ZodError)) logger.error({ err, event }, 'socket handler failed');
          reply({ ok: false, code: e.code, message: e.message });
        }
      };
      socket.on(event as string, listener as (...args: unknown[]) => void);
    };

    const sendSnapshot = async (sessionId: string, current: AuthUser) => {
      const snapshot = await getSnapshot(current, sessionId);
      socket.emit('session.snapshot', { eventId: randomUUID(), sessionId, occurredAt: new Date().toISOString(), snapshot });
    };

    handle('session.subscribe', async ({ sessionId }, current) => {
      const { access } = await loadSessionWithAccess(current, sessionId); // 404 when the user has no right to see it
      if (access === 'ADMIN') throw forbidden('Administrators cannot join live sessions.');
      if (!subscribed.has(sessionId)) {
        subscribed.set(sessionId, access);
        // The server decides the room from the user's verified access. Clients never name rooms.
        await socket.join(access === 'LECTURER' ? rooms.staff(sessionId) : rooms.students(sessionId));
        if (access === 'STUDENT') {
          trackConnect(sessionId, current.id);
          scheduleParticipantsBroadcast(sessionId);
        }
      }
      await sendSnapshot(sessionId, current);
    });

    handle('session.unsubscribe', async ({ sessionId }) => leave(sessionId));

    handle('session.request_snapshot', async ({ sessionId }, current) => {
      if (!subscribed.has(sessionId)) throw forbidden('Subscribe to the session first.');
      await sendSnapshot(sessionId, current);
    });

    socket.on('disconnect', () => {
      for (const sessionId of [...subscribed.keys()]) leave(sessionId);
    });
  });

  return io;
}
