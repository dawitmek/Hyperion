import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { seedLibrary } from './media/library.js';

const config = loadConfig();
await runMigrations(config.databaseUrl);
const app = await buildApp(config);
await seedLibrary(app.db);
app.debug.write('server', null, 'started');
await app.live.closeAbandonedStreams();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close());
}

await app.listen({ port: config.port, host: config.host });
