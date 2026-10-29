import { Router } from 'express';
import type { Limiters } from '../../middleware/rateLimit.ts';
import { currentUser } from '../../middleware/auth.ts';
import { validate } from '../../middleware/validate.ts';
import { toStaffPoll } from './poll.dto.ts';
import { createPollBody, pollIdParams, sessionIdParams, submitResponseBody, updatePollBody } from './poll.schemas.ts';
import * as svc from './poll.service.ts';

export function pollsRouter(limiters: Limiters) {
  const r = Router();

  r.get('/sessions/:sessionId/polls', validate({ params: sessionIdParams }), async (req, res) => {
    res.json({ items: await svc.listPolls(currentUser(req), req.params.sessionId as string), serverTime: new Date().toISOString() });
  });

  r.post('/sessions/:sessionId/polls', validate({ params: sessionIdParams, body: createPollBody }), async (req, res) => {
    const poll = await svc.createPoll(currentUser(req), req.params.sessionId as string, req.body);
    res.status(201).json({ poll: toStaffPoll(poll) });
  });

  r.get('/polls/:pollId', validate({ params: pollIdParams }), async (req, res) => {
    res.json({ poll: await svc.getPollView(currentUser(req), req.params.pollId as string), serverTime: new Date().toISOString() });
  });

  r.put('/polls/:pollId', validate({ params: pollIdParams, body: updatePollBody }), async (req, res) => {
    res.json({ poll: toStaffPoll(await svc.updateDraftPoll(currentUser(req), req.params.pollId as string, req.body)) });
  });

  r.delete('/polls/:pollId', validate({ params: pollIdParams }), async (req, res) => {
    await svc.deleteDraftPoll(currentUser(req), req.params.pollId as string);
    res.status(204).end();
  });

  const transitions = { open: svc.openPoll, pause: svc.pausePoll, resume: svc.resumePoll, close: svc.closePoll, 'reveal-results': svc.revealResults } as const;
  for (const [path, fn] of Object.entries(transitions)) {
    r.post(`/polls/:pollId/${path}`, validate({ params: pollIdParams }), async (req, res) => {
      res.json({ poll: toStaffPoll(await fn(currentUser(req), req.params.pollId as string)) });
    });
  }

  r.post('/polls/:pollId/responses', limiters.submit, validate({ params: pollIdParams, body: submitResponseBody }), async (req, res) => {
    const outcome = await svc.submitResponse(currentUser(req), req.params.pollId as string, req.body);
    res.status(outcome === 'created' ? 201 : 200).json({ status: outcome });
  });

  r.get('/polls/:pollId/results', validate({ params: pollIdParams }), async (req, res) => {
    res.json({ results: await svc.getResultsFor(currentUser(req), req.params.pollId as string) });
  });

  return r;
}
