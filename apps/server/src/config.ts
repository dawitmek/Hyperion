export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  eulerApiKey: string | undefined;
  production: boolean;
  secureCookies: boolean;
  piperBin: string | undefined;
  piperVoicesDir: string | undefined;
  tiktokSessionId: string | undefined;
  secretsKey: Buffer;
  signupsEnabled: boolean;
  publicUrl?: string; // where the server is reached, for links in emails; never taken from a request's Host header
  smtpUrl?: string; // e.g. smtps://user:pass@smtp.example.com:465; without it, no emails are sent
  mailFrom?: string;
  trustProxy?: string; // addresses of the reverse proxies in front, so rate limits see each client's own address
  debugLog?: string; // a file for the debug log (see debug-log.ts); never set in production
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required (see .env.example)');
  // Encrypts hosts' API keys and TikTok sessions in the database. Losing it means hosts re-enter them.
  const secretsKey = Buffer.from(env.SECRETS_KEY ?? '', 'base64');
  if (secretsKey.length !== 32) {
    throw new Error('SECRETS_KEY must be 32 random bytes in base64. Generate one with: openssl rand -base64 32');
  }
  const publicUrl = (env.PUBLIC_URL || (env.DOMAIN ? `https://${env.DOMAIN}` : '')).replace(/\/+$/, '') || undefined;
  if (publicUrl && !/^https?:\/\/[^/]+$/.test(publicUrl)) {
    throw new Error(`PUBLIC_URL must be the server's address with no path, like https://hyperion.example.com (got ${publicUrl})`);
  }
  return {
    databaseUrl,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    eulerApiKey: env.EULER_API_KEY || undefined,
    production: env.NODE_ENV === 'production',
    // Secure cookies need HTTPS. Defaults on in production; COOKIE_SECURE=false allows plain HTTP on a LAN.
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
    // Optional server-side TTS. The Docker image sets both; without them the Piper engine falls back to eSpeak.
    piperBin: env.PIPER_BIN || undefined,
    piperVoicesDir: env.PIPER_VOICES_DIR || undefined,
    // Optional: a TikTok account's sessionid cookie, used for TikTok voices by every host who hasn't signed in themselves.
    tiktokSessionId: env.TIKTOK_SESSION_ID || undefined,
    secretsKey,
    // On unless set to false: a server that's only for invited hosts closes signups once they've joined.
    signupsEnabled: env.SIGNUPS_ENABLED !== 'false',
    publicUrl,
    smtpUrl: env.SMTP_URL || undefined,
    mailFrom: env.MAIL_FROM || undefined,
    // Off unless set: trusting X-Forwarded-For from anyone would let clients pick their own address.
    trustProxy: env.TRUST_PROXY && env.TRUST_PROXY !== 'none' ? env.TRUST_PROXY : undefined,
    // For development only: production ignores it, so a debug setting left in an .env can't fill a server's disk.
    debugLog: env.NODE_ENV === 'production' ? undefined : env.DEBUG_LOG || undefined,
  };
}
