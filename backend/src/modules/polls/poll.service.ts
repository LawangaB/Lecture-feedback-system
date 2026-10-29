import { prisma, Prisma, type Tx } from '../../db.ts';
import type { AuthUser } from '../../middleware/auth.ts';
import { loadPollWithAccess, loadSessionAsLecturer, loadSessionWithAccess } from '../../services/permissions.ts';
import { audit } from '../../services/audit.ts';
import { hub } from '../../realtime/hub.ts';
import { conflict, forbidden, notFound, AppError } from '../../utils/errors.ts';
import { logger } from '../../utils/logger.ts';
import { toStaffPoll, toStudentPoll, resultsVisibleToStudents, type PollRow } from './poll.dto.ts';
import { computeResults } from './poll.results.ts';
import type { z } from 'zod';
import type { createPollBody, submitResponseBody } from './poll.schemas.ts';

const rowInclude = { options: { orderBy: { position: 'asc' as const } } };

async function loadRow(pollId: string): Promise<PollRow | null> {
  return prisma.poll.findUnique({ where: { id: pollId }, include: rowInclude });
}

type PollInput = z.infer<typeof createPollBody>;

function pollData(input: PollInput) {
  const multi = input.type === 'MULTIPLE_CHOICE';
  const rating = input.type === 'RATING';
  return {
    question: input.question,
    type: input.type,
    isAnonymous: input.isAnonymous,
    allowResponseUpdate: input.isAnonymous ? false : input.allowResponseUpdate,
    isRequired: input.isRequired,
    resultsVisibility: input.resultsVisibility,
    minSelections: multi ? (input.minSelections ?? 1) : null,
    maxSelections: multi ? (input.maxSelections ?? input.options.length) : null,
    ratingMin: rating ? (input.ratingMin ?? 1) : null,
    ratingMax: rating ? (input.ratingMax ?? 5) : null,
    durationSeconds: input.durationSeconds ?? null,
  };
}

export async function createPoll(user: AuthUser, sessionId: string, input: PollInput) {
  const session = await loadSessionAsLecturer(user, sessionId);
  if (session.status === 'ENDED') throw conflict('SESSION_ENDED', 'This session has ended.');
  const last = await prisma.poll.aggregate({ where: { sessionId }, _max: { position: true } });
  const poll = await prisma.poll.create({
    data: {
      ...pollData(input),
      sessionId,
      createdById: user.id,
      position: (last._max.position ?? -1) + 1,
      options: { create: input.options.map((label, position) => ({ label, position })) },
    },
    include: rowInclude,
  });
  hub.toStaff(sessionId, 'poll.created', { poll: toStaffPoll(poll) });
  return poll;
}

export async function updateDraftPoll(user: AuthUser, pollId: string, input: PollInput) {
  const { poll } = await loadPollWithAccess(user, pollId);
  await loadSessionAsLecturer(user, poll.sessionId);
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.poll.updateMany({ where: { id: pollId, status: 'DRAFT' }, data: pollData(input) });
    if (res.count !== 1) throw conflict('POLL_NOT_EDITABLE', 'Only draft polls can be edited.');
    await tx.pollOption.deleteMany({ where: { pollId } });
    await tx.pollOption.createMany({ data: input.options.map((label, position) => ({ pollId, label, position })) });
    return tx.poll.findUniqueOrThrow({ where: { id: pollId }, include: rowInclude });
  });
  hub.toStaff(poll.sessionId, 'poll.updated', { poll: toStaffPoll(updated) });
  return updated;
}

export async function deleteDraftPoll(user: AuthUser, pollId: string) {
  const { poll } = await loadPollWithAccess(user, pollId);
  await loadSessionAsLecturer(user, poll.sessionId);
  const res = await prisma.poll.deleteMany({ where: { id: pollId, status: 'DRAFT' } });
  if (res.count !== 1) throw conflict('POLL_NOT_EDITABLE', 'Only draft polls can be deleted.');
  hub.toStaff(poll.sessionId, 'poll.deleted', { pollId });
}

/** Serialises state changes within one session so "only one active poll" cannot be raced. */
async function lockSession(tx: Tx, sessionId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))::text AS locked`;
}

async function broadcastPoll(pollId: string, event: 'poll.opened' | 'poll.updated' | 'poll.closed') {
  const row = await loadRow(pollId);
  if (!row) return;
  hub.toAudiences(row.sessionId, event, { poll: toStaffPoll(row) }, { poll: toStudentPoll(row) });
  return row;
}

export async function openPoll(user: AuthUser, pollId: string) {
  const { poll } = await loadPollWithAccess(user, pollId);
  const session = await loadSessionAsLecturer(user, poll.sessionId);
  if (session.status !== 'LIVE') throw conflict('SESSION_NOT_LIVE', 'Start the session before opening a poll.');
  await prisma.$transaction(async (tx) => {
    await lockSession(tx, poll.sessionId);
    const active = await tx.poll.count({ where: { sessionId: poll.sessionId, status: { in: ['OPEN', 'PAUSED'] } } });
    if (active > 0) throw conflict('POLL_ALREADY_ACTIVE', 'Close the active poll before opening another.');
    const now = new Date();
    const res = await tx.poll.updateMany({
      where: { id: pollId, status: 'DRAFT' },
      data: { status: 'OPEN', openedAt: now, closesAt: poll.durationSeconds ? new Date(now.getTime() + poll.durationSeconds * 1000) : null, remainingMs: null },
    });
    if (res.count !== 1) throw conflict('INVALID_POLL_STATE', 'Only a draft poll can be opened.');
  });
  await audit(user.id, 'poll.open', { type: 'Poll', id: pollId });
  const row = await broadcastPoll(pollId, 'poll.opened');
  return row!;
}

export async function pausePoll(user: AuthUser, pollId: string) {
  const { poll } = await loadPollWithAccess(user, pollId);
  await loadSessionAsLecturer(user, poll.sessionId);
  await pauseRow(pollId);
  return (await broadcastPoll(pollId, 'poll.updated'))!;
}

async function pauseRow(pollId: string): Promise<boolean> {
  const current = await prisma.poll.findUnique({ where: { id: pollId }, select: { closesAt: true, status: true } });
  if (!current || current.status !== 'OPEN') throw conflict('INVALID_POLL_STATE', 'Only an open poll can be paused.');
  const remaining = current.closesAt ? Math.max(0, current.closesAt.getTime() - Date.now()) : null;
  const res = await prisma.poll.updateMany({ where: { id: pollId, status: 'OPEN' }, data: { status: 'PAUSED', remainingMs: remaining, closesAt: null } });
  if (res.count !== 1) throw conflict('INVALID_POLL_STATE', 'Only an open poll can be paused.');
  return true;
}

export async function resumePoll(user: AuthUser, pollId: string) {
  const { poll } = await loadPollWithAccess(user, pollId);
  const session = await loadSessionAsLecturer(user, poll.sessionId);
  if (session.status !== 'LIVE') throw conflict('SESSION_NOT_LIVE', 'Resume the session first.');
  const res = await prisma.poll.updateMany({
    where: { id: pollId, status: 'PAUSED' },
    data: { status: 'OPEN', closesAt: poll.remainingMs !== null ? new Date(Date.now() + poll.remainingMs) : null, remainingMs: null },
  });
  if (res.count !== 1) throw conflict('INVALID_POLL_STATE', 'Only a paused poll can be resumed.');
  return (await broadcastPoll(pollId, 'poll.updated'))!;
}

/** Closes a poll. `actorId` is null when the timer closes it. Returns false if it was not active. */
export async function closePollInternal(pollId: string, actorId: string | null): Promise<boolean> {
  const res = await prisma.poll.updateMany({
    where: { id: pollId, status: { in: ['OPEN', 'PAUSED'] } },
    data: { status: 'CLOSED', closedAt: new Date(), remainingMs: null },
  });
  if (res.count !== 1) return false;
  await audit(actorId, actorId ? 'poll.close' : 'poll.auto_close', { type: 'Poll', id: pollId });
  await broadcastPoll(pollId, 'poll.closed');
  await broadcastResults(pollId);
  return true;
}

export async function closePoll(user: AuthUser, pollId: string) {
  const { poll } = await loadPollWithAccess(user, pollId);
  await loadSessionAsLecturer(user, poll.sessionId);
  if (!(await closePollInternal(pollId, user.id))) throw conflict('INVALID_POLL_STATE', 'This poll is not open.');
  return (await loadRow(pollId))!;
}

export async function revealResults(user: AuthUser, pollId: string) {
  const { poll } = await loadPollWithAccess(user, pollId);
  await loadSessionAsLecturer(user, poll.sessionId);
  if (poll.status === 'DRAFT') throw conflict('INVALID_POLL_STATE', 'Open the poll before revealing results.');
  await prisma.poll.update({ where: { id: pollId }, data: { resultsRevealed: true } });
  await audit(user.id, 'poll.reveal_results', { type: 'Poll', id: pollId });
  const row = await broadcastPoll(pollId, 'poll.updated');
  await broadcastResults(pollId);
  return row!;
}

/** Called by the session service when a session is paused or ended. */
export async function pauseActivePolls(sessionId: string) {
  const open = await prisma.poll.findMany({ where: { sessionId, status: 'OPEN' }, select: { id: true } });
  for (const p of open) {
    await pauseRow(p.id).catch(() => undefined);
    await broadcastPoll(p.id, 'poll.updated');
  }
}
export async function closeActivePolls(sessionId: string, actorId: string | null) {
  const active = await prisma.poll.findMany({ where: { sessionId, status: { in: ['OPEN', 'PAUSED'] } }, select: { id: true } });
  for (const p of active) await closePollInternal(p.id, actorId);
}

// ---------- results broadcasting ----------

const pending = new Map<string, NodeJS.Timeout>();

export async function broadcastResults(pollId: string) {
  const pendingTimer = pending.get(pollId);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pending.delete(pollId);
  }
  const row = await loadRow(pollId);
  if (!row || row.status === 'DRAFT') return;
  const results = await computeResults(pollId);
  hub.toStaff(row.sessionId, 'poll.results_updated', { pollId, results });
  if (resultsVisibleToStudents(row)) hub.toStudents(row.sessionId, 'poll.results_updated', { pollId, results });
}

/** Coalesces bursts of submissions into at most one aggregate recompute per 250ms per poll. */
export function scheduleResultsBroadcast(pollId: string) {
  if (pending.has(pollId)) return;
  pending.set(
    pollId,
    setTimeout(() => {
      pending.delete(pollId);
      broadcastResults(pollId).catch((err) => logger.error({ err, pollId }, 'results broadcast failed'));
    }, 250),
  );
}

export async function sweepExpiredPolls() {
  const due = await prisma.poll.findMany({ where: { status: 'OPEN', closesAt: { lte: new Date() } }, select: { id: true } });
  for (const p of due) await closePollInternal(p.id, null);
}

export function startPollSweeper(intervalMs = 1000) {
  const timer = setInterval(() => sweepExpiredPolls().catch((err) => logger.error({ err }, 'poll sweeper failed')), intervalMs);
  timer.unref();
  return timer;
}

// ---------- responses ----------

type SubmitInput = z.infer<typeof submitResponseBody>;

function validateAnswer(poll: PollRow, input: SubmitInput): { optionIds: string[]; ratingValue: number | null } {
  const fail = (message: string) => new AppError(400, 'INVALID_ANSWER', message);
  if (poll.type === 'RATING') {
    if (input.optionIds?.length) throw fail('This poll takes a rating, not options.');
    const min = poll.ratingMin ?? 1;
    const max = poll.ratingMax ?? 5;
    if (input.ratingValue === undefined || input.ratingValue < min || input.ratingValue > max) throw fail(`Choose a rating between ${min} and ${max}.`);
    return { optionIds: [], ratingValue: input.ratingValue };
  }
  if (input.ratingValue !== undefined) throw fail('This poll takes options, not a rating.');
  const ids = input.optionIds ?? [];
  if (new Set(ids).size !== ids.length) throw fail('Each option can only be chosen once.');
  // Option ownership: every id must belong to THIS poll (blocks cross-poll option injection).
  const valid = new Set(poll.options.map((o) => o.id));
  if (ids.some((id) => !valid.has(id))) throw fail('One or more selected options do not belong to this poll.');
  if (poll.type === 'SINGLE_CHOICE') {
    if (ids.length !== 1) throw fail('Choose exactly one option.');
  } else {
    const min = poll.minSelections ?? 1;
    const max = poll.maxSelections ?? poll.options.length;
    if (ids.length < min || ids.length > max) throw fail(`Choose between ${min} and ${max} options.`);
  }
  return { optionIds: ids, ratingValue: null };
}

export type SubmitOutcome = 'created' | 'updated' | 'duplicate';

export async function submitResponse(user: AuthUser, pollId: string, input: SubmitInput): Promise<SubmitOutcome> {
  const { poll, access } = await loadPollWithAccess(user, pollId);
  if (access !== 'STUDENT') throw forbidden('Only students can answer polls.');
  const answer = validateAnswer(poll, input);
  const key = input.idempotencyKey;

  const attempt = async (): Promise<SubmitOutcome> =>
    prisma.$transaction(async (tx) => {
      // Re-check state inside the transaction: the client's timer and our earlier read are not authoritative.
      const [fresh, session] = await Promise.all([
        tx.poll.findUniqueOrThrow({ where: { id: pollId }, select: { status: true, closesAt: true } }),
        tx.lectureSession.findUniqueOrThrow({ where: { id: poll.sessionId }, select: { status: true } }),
      ]);
      if (session.status !== 'LIVE') throw new AppError(409, 'SESSION_NOT_LIVE', 'This session is not live.');
      if (fresh.status !== 'OPEN' || (fresh.closesAt && fresh.closesAt.getTime() <= Date.now())) {
        throw new AppError(409, 'POLL_NOT_OPEN', 'This poll is not accepting responses.');
      }
      const existing = await tx.pollParticipation.findUnique({ where: { pollId_userId: { pollId, userId: user.id } } });
      if (existing) {
        if (existing.idempotencyKey === key) return 'duplicate';
        if (!poll.allowResponseUpdate || poll.isAnonymous) throw new AppError(409, 'ALREADY_RESPONDED', 'You have already answered this poll.');
        const response = await tx.pollResponse.findFirstOrThrow({ where: { pollId, userId: user.id }, select: { id: true } });
        await tx.pollResponseOption.deleteMany({ where: { responseId: response.id } });
        await tx.pollResponse.update({ where: { id: response.id }, data: { ratingValue: answer.ratingValue, submittedAt: new Date() } });
        await tx.pollResponseOption.createMany({ data: answer.optionIds.map((optionId) => ({ responseId: response.id, optionId, pollId })) });
        await tx.pollParticipation.update({ where: { id: existing.id }, data: { idempotencyKey: key } });
        return 'updated';
      }
      // The unique (pollId, userId) constraint is the real one-response guarantee under concurrency.
      await tx.pollParticipation.create({ data: { pollId, userId: user.id, idempotencyKey: key } });
      const response = await tx.pollResponse.create({
        data: {
          pollId,
          // Anonymous answers carry no user id and no timestamp, so they cannot be linked back to a person.
          userId: poll.isAnonymous ? null : user.id,
          submittedAt: poll.isAnonymous ? null : new Date(),
          ratingValue: answer.ratingValue,
        },
        select: { id: true },
      });
      if (answer.optionIds.length) {
        await tx.pollResponseOption.createMany({ data: answer.optionIds.map((optionId) => ({ responseId: response.id, optionId, pollId })) });
      }
      return 'created';
    });

  let outcome: SubmitOutcome;
  try {
    outcome = await attempt();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // A concurrent request for the same user won the race. Same key → safe retry; different key → conflict.
      const existing = await prisma.pollParticipation.findUnique({ where: { pollId_userId: { pollId, userId: user.id } } });
      if (existing?.idempotencyKey === key) return 'duplicate';
      throw new AppError(409, 'ALREADY_RESPONDED', 'You have already answered this poll.');
    }
    throw err;
  }
  // Persisted first, broadcast second.
  if (outcome !== 'duplicate') scheduleResultsBroadcast(pollId);
  return outcome;
}

// ---------- reads ----------

export async function listPolls(user: AuthUser, sessionId: string) {
  const { session, access } = await loadSessionWithAccess(user, sessionId);
  if (access === 'STUDENT') {
    const polls = await prisma.poll.findMany({ where: { sessionId: session.id, status: { not: 'DRAFT' } }, include: rowInclude, orderBy: { position: 'asc' } });
    const mine = await prisma.pollParticipation.findMany({ where: { userId: user.id, pollId: { in: polls.map((p) => p.id) } }, select: { pollId: true } });
    const done = new Set(mine.map((m) => m.pollId));
    return polls.map((p) => ({ ...toStudentPoll(p), hasResponded: done.has(p.id) }));
  }
  const polls = await prisma.poll.findMany({ where: { sessionId: session.id }, include: rowInclude, orderBy: { position: 'asc' } });
  const counts = await prisma.pollResponse.groupBy({ by: ['pollId'], where: { pollId: { in: polls.map((p) => p.id) } }, _count: { _all: true } });
  const byPoll = new Map(counts.map((c) => [c.pollId, c._count._all]));
  return polls.map((p) => ({ ...toStaffPoll(p), responseCount: byPoll.get(p.id) ?? 0 }));
}

export async function getPollView(user: AuthUser, pollId: string) {
  const { poll, access } = await loadPollWithAccess(user, pollId);
  if (access !== 'STUDENT') return toStaffPoll(poll);
  const participation = await prisma.pollParticipation.findUnique({ where: { pollId_userId: { pollId, userId: user.id } }, select: { pollId: true } });
  let myResponse: { optionIds: string[]; ratingValue: number | null } | null = null;
  if (participation && !poll.isAnonymous) {
    const r = await prisma.pollResponse.findFirst({ where: { pollId, userId: user.id }, include: { options: true } });
    if (r) myResponse = { optionIds: r.options.map((o) => o.optionId), ratingValue: r.ratingValue };
  }
  return { ...toStudentPoll(poll), hasResponded: Boolean(participation), myResponse };
}

export async function getResultsFor(user: AuthUser, pollId: string) {
  const { poll, access } = await loadPollWithAccess(user, pollId);
  if (access === 'ADMIN') throw forbidden('Administrators cannot view live poll results.');
  if (access === 'STUDENT' && !resultsVisibleToStudents(poll)) throw new AppError(403, 'RESULTS_HIDDEN', 'The lecturer has not released these results yet.');
  if (poll.status === 'DRAFT') throw notFound('Poll');
  return computeResults(pollId);
}
