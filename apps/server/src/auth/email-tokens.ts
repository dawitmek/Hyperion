import { and, eq } from 'drizzle-orm';
import { emailTokens } from '../db/schema.js';
import { newToken, sha256 } from '../crypto.js';
import type { Db } from '../db/client.js';

const TTL_MS = { verify: 24 * 60 * 60 * 1000, reset: 60 * 60 * 1000 };

// A new link replaces any earlier one of the same kind, so only the newest email's link works.
export async function createEmailToken(db: Db, hostId: string, purpose: 'verify' | 'reset') {
  const token = newToken();
  await db.transaction(async (tx) => {
    await tx.delete(emailTokens).where(and(eq(emailTokens.hostId, hostId), eq(emailTokens.purpose, purpose)));
    await tx.insert(emailTokens).values({ tokenHash: sha256(token), hostId, purpose, expiresAt: new Date(Date.now() + TTL_MS[purpose]) });
  });
  return token;
}
