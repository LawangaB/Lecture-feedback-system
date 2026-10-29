import { prisma, type Tx } from '../db.ts';
import { logger } from '../utils/logger.ts';

type Db = Pick<typeof prisma, 'auditLog'> | Tx;

/** Records security-relevant actions. Never put secrets, answers, or free text in `metadata`. */
export async function audit(
  actorId: string | null,
  action: string,
  target?: { type: string; id?: string },
  metadata: Record<string, string | number | boolean | null> = {},
  db: Db = prisma,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: { actorId, action, targetType: target?.type, targetId: target?.id, metadata },
    });
  } catch (err) {
    // Auditing must never take down the request that triggered it.
    logger.error({ err, action }, 'failed to write audit log');
  }
}
