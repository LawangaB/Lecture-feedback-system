import { Router } from 'express';
import type { Limiters } from '../../middleware/rateLimit.ts';
import { currentUser } from '../../middleware/auth.ts';
import { validate } from '../../middleware/validate.ts';
import { courseParams, createSessionBody, joinBody, sessionParams, updateSessionBody } from './session.schemas.ts';
import * as svc from './session.service.ts';

export function sessionsRouter(limiters: Limiters) {
  const r = Router();

  r.get('/sessions', async (req, res) => {
    res.json(await svc.listMySessions(currentUser(req)));
  });

  r.post('/sessions/join', limiters.join, validate({ body: joinBody }), async (req, res) => {
    res.json({ session: await svc.joinWithCode(currentUser(req), req.body.code) });
  });

  r.get('/courses/:courseId/sessions', validate({ params: courseParams }), async (req, res) => {
    res.json({ items: await svc.listCourseSessions(currentUser(req), req.params.courseId as string) });
  });

  r.post('/courses/:courseId/sessions', validate({ params: courseParams, body: createSessionBody }), async (req, res) => {
    res.status(201).json({ session: await svc.createSession(currentUser(req), req.params.courseId as string, req.body) });
  });

  r.get('/sessions/:sessionId', validate({ params: sessionParams }), async (req, res) => {
    res.json(await svc.getSnapshot(currentUser(req), req.params.sessionId as string));
  });

  r.post('/sessions/:sessionId/attend', validate({ params: sessionParams }), async (req, res) => {
    await svc.recordAttendance(currentUser(req), req.params.sessionId as string);
    res.status(204).end();
  });

  r.patch('/sessions/:sessionId', validate({ params: sessionParams, body: updateSessionBody }), async (req, res) => {
    res.json({ session: await svc.updateSession(currentUser(req), req.params.sessionId as string, req.body) });
  });

  for (const action of ['start', 'pause', 'resume', 'end'] as const) {
    r.post(`/sessions/:sessionId/${action}`, validate({ params: sessionParams }), async (req, res) => {
      res.json({ session: await svc.transitionSession(currentUser(req), req.params.sessionId as string, action) });
    });
  }

  r.post('/sessions/:sessionId/join-code/rotate', validate({ params: sessionParams }), async (req, res) => {
    res.json({ session: await svc.rotateJoinCode(currentUser(req), req.params.sessionId as string) });
  });

  return r;
}
