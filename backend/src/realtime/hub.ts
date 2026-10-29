import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';

/**
 * Thin outbound-event gateway. Services call these helpers AFTER their database transaction commits.
 * Events are notifications only; PostgreSQL remains the source of truth and clients refetch snapshots.
 */
let io: Server | null = null;

export const rooms = {
  staff: (sessionId: string) => `session:${sessionId}:staff`,
  students: (sessionId: string) => `session:${sessionId}:students`,
  user: (userId: string) => `user:${userId}`,
};

export function attachIo(server: Server | null) {
  io = server;
}

export type AudienceEvent = { eventId: string; sessionId: string; occurredAt: string } & Record<string, unknown>;

function envelope(sessionId: string, payload: Record<string, unknown>): AudienceEvent {
  return { eventId: randomUUID(), sessionId, occurredAt: new Date().toISOString(), ...payload };
}

export const hub = {
  toStaff(sessionId: string, event: string, payload: Record<string, unknown>) {
    io?.to(rooms.staff(sessionId)).emit(event, envelope(sessionId, payload));
  },
  toStudents(sessionId: string, event: string, payload: Record<string, unknown>) {
    io?.to(rooms.students(sessionId)).emit(event, envelope(sessionId, payload));
  },
  /** Send different payloads to each audience (e.g. staff-only fields). */
  toAudiences(sessionId: string, event: string, staff: Record<string, unknown>, students: Record<string, unknown>) {
    hub.toStaff(sessionId, event, staff);
    hub.toStudents(sessionId, event, students);
  },
  disconnectUser(userId: string) {
    io?.in(rooms.user(userId)).disconnectSockets(true);
  },
};
