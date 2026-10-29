/** In-memory connection presence (single instance). A socket connection is NOT proof of attendance. */
const bySession = new Map<string, Map<string, number>>();

export function trackConnect(sessionId: string, userId: string): number {
  const users = bySession.get(sessionId) ?? new Map<string, number>();
  users.set(userId, (users.get(userId) ?? 0) + 1);
  bySession.set(sessionId, users);
  return users.size;
}

export function trackDisconnect(sessionId: string, userId: string): number {
  const users = bySession.get(sessionId);
  if (!users) return 0;
  const n = (users.get(userId) ?? 0) - 1;
  if (n <= 0) users.delete(userId);
  else users.set(userId, n);
  if (users.size === 0) bySession.delete(sessionId);
  return users.size;
}

export const connectedCount = (sessionId: string) => bySession.get(sessionId)?.size ?? 0;
