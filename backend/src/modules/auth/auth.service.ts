import type { Request } from 'express';
import { prisma, type User } from '../../db.ts';
import { env } from '../../config/env.ts';
import { audit } from '../../services/audit.ts';
import { mailer } from '../../services/mail.ts';
import { hub } from '../../realtime/hub.ts';
import { revokeUserSessions } from '../../middleware/session.ts';
import { ensureCsrfToken } from '../../middleware/csrf.ts';
import { AppError, conflict, unauthorized } from '../../utils/errors.ts';
import { randomToken, sha256Hex } from '../../utils/crypto.ts';
import { hashPassword, verifyPassword } from '../../utils/password.ts';

export const toUserDto = (u: Pick<User, 'id' | 'email' | 'displayName' | 'role'>) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
});

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}
function save(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

/** Rotate the session id (fixation defence) and bind it to the user. Returns the fresh CSRF token. */
export async function establishSession(req: Request, userId: string): Promise<string> {
  await regenerate(req);
  req.session.userId = userId;
  req.session.createdAt = Date.now();
  const token = ensureCsrfToken(req);
  await save(req);
  return token;
}

export async function register(req: Request, input: { email: string; password: string; displayName: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw conflict('EMAIL_IN_USE', 'An account with this email already exists.');
  const user = await prisma.user.create({
    // Self-registration always creates a STUDENT. Lecturers and admins are provisioned by an administrator.
    data: { email: input.email, displayName: input.displayName, passwordHash: await hashPassword(input.password), role: 'STUDENT' },
  });
  await audit(user.id, 'auth.register', { type: 'User', id: user.id });
  const csrfToken = await establishSession(req, user.id);
  return { user: toUserDto(user), csrfToken };
}

export async function login(req: Request, input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = await verifyPassword(user?.passwordHash, input.password);
  if (!user || !ok || !user.isActive) {
    await audit(user?.id ?? null, 'auth.login_failed', user ? { type: 'User', id: user.id } : undefined, { reason: !user ? 'unknown_email' : !user.isActive && ok ? 'inactive' : 'bad_password' });
    // One generic message for every failure mode.
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  const csrfToken = await establishSession(req, user.id);
  await audit(user.id, 'auth.login', { type: 'User', id: user.id });
  return { user: toUserDto(user), csrfToken };
}

export async function logout(req: Request): Promise<void> {
  const userId = req.session.userId;
  await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
  if (userId) {
    hub.disconnectUser(userId);
    await audit(userId, 'auth.logout', { type: 'User', id: userId });
  }
}

const RESET_TTL_MS = 30 * 60 * 1000;

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return; // identical outward behaviour whether or not the account exists
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } }),
  ]);
  const link = `${env.FRONTEND_ORIGIN}/reset-password?token=${token}`;
  await mailer.send({
    to: user.email,
    subject: 'Reset your Lecture Feedback password',
    text: `Use this link within 30 minutes to choose a new password:\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
  });
  await audit(user.id, 'auth.reset_requested', { type: 'User', id: user.id });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.');
  }
  const passwordHash = await hashPassword(newPassword);
  // Single-use: the conditional update only succeeds for one concurrent caller.
  const claimed = await prisma.$transaction(async (tx) => {
    const res = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (res.count !== 1) return false;
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    return true;
  });
  if (!claimed) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.');
  await revokeUserSessions(record.userId);
  hub.disconnectUser(record.userId);
  await audit(record.userId, 'auth.password_reset', { type: 'User', id: record.userId });
}

export async function changePassword(req: Request, userId: string, current: string, next: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(user.passwordHash, current))) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Your current password is incorrect.');
  }
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await revokeUserSessions(userId);
  hub.disconnectUser(userId);
  const csrfToken = await establishSession(req, userId); // privilege-relevant change → fresh session id
  await audit(userId, 'auth.password_changed', { type: 'User', id: userId });
  return { csrfToken };
}

export function requireUserId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}
