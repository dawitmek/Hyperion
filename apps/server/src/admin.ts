// Server admin commands, for a server without email. With Docker:
//   docker compose -f docker/compose.yml --env-file .env exec hyperion node apps/server/dist/admin.js reset-link <email>
import { eq } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { hosts } from './db/schema.js';
import { createEmailToken } from './auth/email-tokens.js';

const [command, email] = process.argv.slice(2);
if (command !== 'reset-link' || !email) {
  console.error('Usage: node apps/server/dist/admin.js reset-link <email>');
  process.exit(1);
}

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
try {
  const [host] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.email, email.toLowerCase()));
  if (!host) {
    console.error(`No account has the email ${email}`);
    process.exitCode = 1;
  } else {
    const token = await createEmailToken(db, host.id, 'reset');
    // Without PUBLIC_URL, the path is printed for the admin to put after the server's address.
    console.log(`${config.publicUrl ?? ''}/reset-password#${token}`);
    console.log('Send this to them privately. It works once, for 1 hour, and signs them out everywhere else.');
  }
} finally {
  await close();
}
