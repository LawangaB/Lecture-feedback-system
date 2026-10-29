import argon2 from 'argon2';

// OWASP-recommended Argon2id baseline: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => argon2.hash(plain, OPTIONS);

// A real hash verified when the account does not exist, so response timing does not reveal existence.
const DUMMY_HASH = await argon2.hash('dummy-password-for-timing-equalisation', OPTIONS);

export async function verifyPassword(hash: string | null | undefined, plain: string): Promise<boolean> {
  try {
    const ok = await argon2.verify(hash ?? DUMMY_HASH, plain);
    return ok && Boolean(hash);
  } catch {
    return false;
  }
}
