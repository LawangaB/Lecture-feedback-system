import { prisma } from '../../db.ts';

export interface PollResults {
  pollId: string;
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'RATING';
  totalResponses: number;
  /** Students who joined the session (attendance records). The denominator for responseRate. */
  joinedParticipants: number;
  responseRate: number | null;
  options: { id: string; label: string; count: number; percentOfRespondents: number }[];
  rating: { min: number; max: number; average: number | null; distribution: { value: number; count: number }[] } | null;
}

/** Aggregates only — never individual answers. Safe for any audience the poll's visibility rules allow. */
export async function computeResults(pollId: string): Promise<PollResults> {
  const poll = await prisma.poll.findUniqueOrThrow({ where: { id: pollId }, include: { options: { orderBy: { position: 'asc' } } } });
  const [total, joined, optionCounts, ratingCounts] = await Promise.all([
    prisma.pollResponse.count({ where: { pollId } }),
    prisma.attendanceRecord.count({ where: { sessionId: poll.sessionId, user: { role: 'STUDENT' } } }),
    prisma.pollResponseOption.groupBy({ by: ['optionId'], where: { pollId }, _count: { _all: true } }),
    prisma.pollResponse.groupBy({ by: ['ratingValue'], where: { pollId, ratingValue: { not: null } }, _count: { _all: true } }),
  ]);
  const countByOption = new Map(optionCounts.map((c) => [c.optionId, c._count._all]));
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  let rating: PollResults['rating'] = null;
  if (poll.type === 'RATING') {
    const min = poll.ratingMin ?? 1;
    const max = poll.ratingMax ?? 5;
    const byValue = new Map(ratingCounts.map((c) => [c.ratingValue as number, c._count._all]));
    const distribution = Array.from({ length: max - min + 1 }, (_, i) => ({ value: min + i, count: byValue.get(min + i) ?? 0 }));
    const rated = distribution.reduce((s, d) => s + d.count, 0);
    const sum = distribution.reduce((s, d) => s + d.value * d.count, 0);
    rating = { min, max, average: rated > 0 ? Math.round((sum / rated) * 100) / 100 : null, distribution };
  }

  return {
    pollId,
    type: poll.type,
    totalResponses: total,
    joinedParticipants: joined,
    responseRate: joined > 0 ? Math.min(1, total / joined) : null,
    options: poll.options.map((o) => {
      const count = countByOption.get(o.id) ?? 0;
      return { id: o.id, label: o.label, count, percentOfRespondents: pct(count) };
    }),
    rating,
  };
}
