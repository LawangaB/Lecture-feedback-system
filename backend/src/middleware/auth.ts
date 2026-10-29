import type { NextFunction, Request, Response } from 'express';
import { prisma, type Role } from '../db.ts';
import { env } from '../config/env.ts';
import { forbidden, unauthorized } from '../utils/errors.ts';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

/** Loads the current user from the server-side session and re-checks that the account is still active. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const userId = req.session?.userId;
    if (!userId) throw unauthorized();
    const createdAt = req.session.createdAt ?? 0;
    if (Date.now() - createdAt > env.SESSION_ABSOLUTE_HOURS * 3600_000) {
      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      throw unauthorized('Session expired. Please sign in again.');
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      throw unauthorized();
    }
    req.user = { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Global-role gate. Resource-level checks still happen in the permission service. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
