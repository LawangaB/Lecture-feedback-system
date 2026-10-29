import type { Poll, PollOption } from '../../db.ts';

export type PollRow = Poll & { options: PollOption[] };

/** Students may see aggregates only when the lecturer's settings (or a manual reveal) allow it. */
export function resultsVisibleToStudents(p: Pick<Poll, 'status' | 'resultsVisibility' | 'resultsRevealed'>): boolean {
  if (p.status === 'DRAFT') return false;
  if (p.resultsRevealed) return true;
  if (p.resultsVisibility === 'LIVE') return true;
  return p.resultsVisibility === 'AFTER_CLOSE' && p.status === 'CLOSED';
}

function remainingMs(p: Poll): number | null {
  if (p.status === 'OPEN' && p.closesAt) return Math.max(0, p.closesAt.getTime() - Date.now());
  if (p.status === 'PAUSED') return p.remainingMs;
  return null;
}

const base = (p: PollRow) => ({
  id: p.id,
  sessionId: p.sessionId,
  question: p.question,
  type: p.type,
  status: p.status,
  isAnonymous: p.isAnonymous,
  allowResponseUpdate: p.allowResponseUpdate,
  isRequired: p.isRequired,
  minSelections: p.minSelections,
  maxSelections: p.maxSelections,
  ratingMin: p.ratingMin,
  ratingMax: p.ratingMax,
  durationSeconds: p.durationSeconds,
  closesAt: p.closesAt?.toISOString() ?? null,
  remainingMs: remainingMs(p),
  position: p.position,
  options: [...p.options].sort((a, b) => a.position - b.position).map((o) => ({ id: o.id, label: o.label, position: o.position })),
});

/** Safe to broadcast to every student in the session room: contains no per-user data. */
export const toStudentPoll = (p: PollRow) => ({ ...base(p), resultsVisible: resultsVisibleToStudents(p) });

export const toStaffPoll = (p: PollRow) => ({
  ...base(p),
  resultsVisibility: p.resultsVisibility,
  resultsRevealed: p.resultsRevealed,
  resultsVisible: resultsVisibleToStudents(p),
  openedAt: p.openedAt?.toISOString() ?? null,
  closedAt: p.closedAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
});

export type StudentPoll = ReturnType<typeof toStudentPoll>;
export type StaffPoll = ReturnType<typeof toStaffPoll>;
