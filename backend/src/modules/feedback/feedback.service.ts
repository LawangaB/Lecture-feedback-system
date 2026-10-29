import { prisma, Prisma, type FeedbackDimension } from '../../db.ts';
import type { AuthUser } from '../../middleware/auth.ts';
import { audit } from '../../services/audit.ts';
import { hub } from '../../realtime/hub.ts';
import { loadSessionAsLecturer, loadSessionWithAccess, requireCourseLecturer } from '../../services/permissions.ts';
import { AppError, forbidden, notFound } from '../../utils/errors.ts';

export const DIMENSIONS: FeedbackDimension[] = ['CLARITY', 'PACE', 'ENGAGEMENT', 'MATERIALS'];

export interface FeedbackInput {
  ratings: Partial<Record<FeedbackDimension, number>>;
  comment?: string;
  anonymous: boolean;
}

export async function submitFeedback(user: AuthUser, sessionId: string, input: FeedbackInput) {
  const { session, access } = await loadSessionWithAccess(user, sessionId);
  if (access !== 'STUDENT') throw forbidden('Only students can submit lecture feedback.');
  if (!session.feedbackEnabled) throw new AppError(409, 'FEEDBACK_DISABLED', 'Feedback is not enabled for this session.');
  if (session.status === 'SCHEDULED') throw new AppError(409, 'SESSION_NOT_STARTED', 'This session has not started yet.');
  const comment = input.comment?.trim() || null;
  const ratingRows = DIMENSIONS.filter((d) => input.ratings[d] !== undefined).map((d) => ({ dimension: d, value: input.ratings[d] as number }));
  if (ratingRows.length === 0 && !comment) throw new AppError(400, 'EMPTY_FEEDBACK', 'Add a rating or a comment.');
  try {
    await prisma.$transaction(async (tx) => {
      // Participation records THAT feedback was given; the entry holds WHAT was said (and who, only if identified).
      await tx.feedbackParticipation.create({ data: { sessionId, userId: user.id } });
      await tx.feedbackEntry.create({
        data: {
          sessionId,
          userId: input.anonymous ? null : user.id,
          createdAt: input.anonymous ? null : new Date(),
          comment,
          ratings: { create: ratingRows },
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'ALREADY_SUBMITTED', 'You have already sent feedback for this session.');
    }
    throw err;
  }
  hub.toStaff(sessionId, 'feedback.received', { total: await prisma.feedbackEntry.count({ where: { sessionId } }) });
}

export async function hasSubmitted(user: AuthUser, sessionId: string): Promise<boolean> {
  await loadSessionWithAccess(user, sessionId);
  return Boolean(await prisma.feedbackParticipation.findUnique({ where: { sessionId_userId: { sessionId, userId: user.id } } }));
}

export interface FeedbackFilters {
  dimension?: FeedbackDimension;
  minRating?: number;
  maxRating?: number;
  anonymous?: boolean;
  hasComment?: boolean;
  includeHidden?: boolean;
  page: number;
  pageSize: number;
}

export async function listFeedback(user: AuthUser, sessionId: string, f: FeedbackFilters) {
  await loadSessionAsLecturer(user, sessionId);
  const where: Prisma.FeedbackEntryWhereInput = {
    sessionId,
    ...(f.anonymous === undefined ? {} : { userId: f.anonymous ? null : { not: null } }),
    ...(f.hasComment ? { comment: { not: null } } : {}),
    ...(f.dimension || f.minRating || f.maxRating
      ? { ratings: { some: { ...(f.dimension ? { dimension: f.dimension } : {}), value: { gte: f.minRating ?? 1, lte: f.maxRating ?? 5 } } } }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.feedbackEntry.count({ where }),
    prisma.feedbackEntry.findMany({
      where,
      include: { ratings: true, user: { select: { displayName: true } } },
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
  ]);
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    items: rows.map((e) => ({
      id: e.id,
      ratings: Object.fromEntries(e.ratings.map((r) => [r.dimension, r.value])),
      // Hidden comments are withheld from the lecturer's list unless explicitly requested for moderation.
      comment: e.isHidden && !f.includeHidden ? null : e.comment,
      isHidden: e.isHidden,
      author: e.userId && e.user ? { displayName: e.user.displayName } : null,
      createdAt: e.createdAt?.toISOString() ?? null,
    })),
  };
}

export async function feedbackSummary(sessionId: string) {
  const [entries, joined, comments, ratings] = await Promise.all([
    prisma.feedbackEntry.count({ where: { sessionId } }),
    prisma.attendanceRecord.count({ where: { sessionId, user: { role: 'STUDENT' } } }),
    prisma.feedbackEntry.count({ where: { sessionId, comment: { not: null }, isHidden: false } }),
    prisma.feedbackRating.groupBy({ by: ['dimension', 'value'], where: { entry: { sessionId } }, _count: { _all: true } }),
  ]);
  return {
    totalEntries: entries,
    joinedParticipants: joined,
    submissionRate: joined > 0 ? Math.min(1, entries / joined) : null,
    commentCount: comments,
    dimensions: DIMENSIONS.map((dimension) => {
      const rows = ratings.filter((r) => r.dimension === dimension);
      const distribution = [1, 2, 3, 4, 5].map((value) => ({ value, count: rows.find((r) => r.value === value)?._count._all ?? 0 }));
      const count = distribution.reduce((s, d) => s + d.count, 0);
      const sum = distribution.reduce((s, d) => s + d.value * d.count, 0);
      return { dimension, count, average: count ? Math.round((sum / count) * 100) / 100 : null, distribution };
    }),
  };
}

export async function getFeedbackSummary(user: AuthUser, sessionId: string) {
  await loadSessionAsLecturer(user, sessionId);
  return feedbackSummary(sessionId);
}

export async function setHidden(user: AuthUser, entryId: string, isHidden: boolean) {
  const entry = await prisma.feedbackEntry.findUnique({ where: { id: entryId }, select: { id: true, session: { select: { id: true, courseId: true } } } });
  if (!entry) throw notFound('Feedback');
  await requireCourseLecturer(user, entry.session.courseId);
  await prisma.feedbackEntry.update({ where: { id: entryId }, data: { isHidden } });
  await audit(user.id, isHidden ? 'feedback.hide' : 'feedback.unhide', { type: 'FeedbackEntry', id: entryId });
}
