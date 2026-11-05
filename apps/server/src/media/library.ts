import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { and, inArray, isNull, not } from 'drizzle-orm';
import { BUILT_IN_MEDIA } from '@hyperion/shared';
import type { Db } from '../db/client.js';
import { media } from '../db/schema.js';
import { sniff } from './sniff.js';

const folder = new URL('../../assets/library/', import.meta.url);

// A file's id comes from its name, so actions using it survive restarts and updates.
const idOf = (file: string) => {
  const hex = createHash('sha1').update(`hyperion-library:${file}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

// Puts the files every host can use in the database, once: rows with no host. Runs at startup, so a new release's
// files arrive by themselves and ones it dropped go.
export async function seedLibrary(db: Db) {
  const ids: string[] = [];
  for (const { file, name, kind } of BUILT_IN_MEDIA) {
    const data = await readFile(fileURLToPath(new URL(file, folder)));
    const type = sniff(data);
    if (type?.kind !== kind) throw new Error(`Built-in file ${file} isn't the ${kind} it's listed as`);
    const row = { name, ...type, size: data.length, data };
    const id = idOf(file);
    ids.push(id);
    await db.insert(media).values({ id, hostId: null, ...row }).onConflictDoUpdate({ target: media.id, set: row });
  }
  await db.delete(media).where(and(isNull(media.hostId), not(inArray(media.id, ids))));
}
