import { Router } from 'express';
import { z } from 'zod';
import type { Limiters } from '../../middleware/rateLimit.ts';
import { currentUser, requireRole } from '../../middleware/auth.ts';
import { validate } from '../../middleware/validate.ts';
import * as svc from './analytics.service.ts';

const sessionParams = z.object({ sessionId: z.string().uuid() });

export function analyticsRouter(limiters: Limiters) {
  const r = Router();

  r.get('/analytics/lecturer/overview', requireRole('LECTURER'), async (req, res) => {
    res.json(await svc.lecturerOverview(currentUser(req)));
  });

  r.get('/sessions/:sessionId/report', validate({ params: sessionParams }), async (req, res) => {
    res.json(await svc.sessionReport(currentUser(req), req.params.sessionId as string));
  });

  r.get('/sessions/:sessionId/export.csv', limiters.exports, validate({ params: sessionParams, query: z.object({ type: z.enum(['results', 'feedback']).default('results') }).strict() }), async (req, res) => {
    const { filename, body } = await svc.exportCsv(currentUser(req), req.params.sessionId as string, (req.query as { type: 'results' | 'feedback' }).type);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  });

  return r;
}
