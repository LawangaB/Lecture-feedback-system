import { Router } from 'express';
import { z } from 'zod';
import { listQuery, sessionParams, submitBody } from './feedback.schemas.ts';
import type { Limiters } from '../../middleware/rateLimit.ts';
import { currentUser } from '../../middleware/auth.ts';
import { validate } from '../../middleware/validate.ts';
import * as svc from './feedback.service.ts';

export function feedbackRouter(limiters: Limiters) {
  const r = Router();

  r.post('/sessions/:sessionId/feedback', limiters.feedback, validate({ params: sessionParams, body: submitBody }), async (req, res) => {
    await svc.submitFeedback(currentUser(req), req.params.sessionId as string, req.body);
    res.status(201).json({ status: 'received' });
  });

  r.get('/sessions/:sessionId/feedback/mine', validate({ params: sessionParams }), async (req, res) => {
    res.json({ submitted: await svc.hasSubmitted(currentUser(req), req.params.sessionId as string) });
  });

  r.get('/sessions/:sessionId/feedback/summary', validate({ params: sessionParams }), async (req, res) => {
    res.json({ summary: await svc.getFeedbackSummary(currentUser(req), req.params.sessionId as string) });
  });

  r.get('/sessions/:sessionId/feedback', validate({ params: sessionParams, query: listQuery }), async (req, res) => {
    res.json(await svc.listFeedback(currentUser(req), req.params.sessionId as string, req.query as never));
  });

  r.patch('/feedback/:entryId', validate({ params: z.object({ entryId: z.string().uuid() }), body: z.object({ isHidden: z.boolean() }).strict() }), async (req, res) => {
    await svc.setHidden(currentUser(req), req.params.entryId as string, req.body.isHidden);
    res.status(204).end();
  });

  return r;
}
