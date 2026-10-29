import { Router } from 'express';
import type { Limiters } from '../../middleware/rateLimit.ts';
import { requireAuth, currentUser } from '../../middleware/auth.ts';
import { ensureCsrfToken } from '../../middleware/csrf.ts';
import { validate } from '../../middleware/validate.ts';
import { prisma } from '../../db.ts';
import { env } from '../../config/env.ts';
import { changePasswordBody, forgotBody, loginBody, registerBody, resetBody, updateProfileBody } from './auth.schemas.ts';
import * as svc from './auth.service.ts';

export function authRouter(limiters: Limiters) {
  const r = Router();

  // Issues a session-bound CSRF token (and the session cookie) before any state-changing call.
  r.get('/csrf', (req, res) => {
    res.json({ csrfToken: ensureCsrfToken(req) });
  });

  r.post('/register', limiters.authIp, limiters.auth, validate({ body: registerBody }), async (req, res) => {
    res.status(201).json(await svc.register(req, req.body));
  });

  r.post('/login', limiters.authIp, limiters.auth, validate({ body: loginBody }), async (req, res) => {
    res.json(await svc.login(req, req.body));
  });

  r.post('/logout', async (req, res) => {
    await svc.logout(req);
    res.clearCookie(env.SESSION_COOKIE_NAME);
    res.status(204).end();
  });

  r.post('/forgot-password', limiters.authIp, limiters.auth, validate({ body: forgotBody }), async (req, res) => {
    await svc.requestPasswordReset(req.body.email);
    // Always the same response, whether or not the email is registered.
    res.status(202).json({ message: 'If an account exists for that email, a reset link is on its way.' });
  });

  r.post('/reset-password', limiters.authIp, limiters.auth, validate({ body: resetBody }), async (req, res) => {
    await svc.resetPassword(req.body.token, req.body.newPassword);
    res.json({ message: 'Password updated. You can now sign in.' });
  });

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: svc.toUserDto(currentUser(req)) });
  });

  r.patch('/me', requireAuth, validate({ body: updateProfileBody }), async (req, res) => {
    const user = await prisma.user.update({ where: { id: currentUser(req).id }, data: { displayName: req.body.displayName } });
    res.json({ user: svc.toUserDto(user) });
  });

  r.post('/change-password', requireAuth, limiters.auth, validate({ body: changePasswordBody }), async (req, res) => {
    const out = await svc.changePassword(req, currentUser(req).id, req.body.currentPassword, req.body.newPassword);
    res.json(out);
  });

  return r;
}
