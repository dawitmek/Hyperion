// Failed logins per account, on top of the per-address rate limit, so guesses spread over many addresses still stop.
// Kept in memory: a restart clears it, which only gives an attacker a fresh 10 guesses.
// Someone can lock an account out for a while by failing on purpose; a password reset unlocks it.
export const MAX_FAILED_LOGINS = 10;
export const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED = 10_000;

export class LoginLimiter {
  private failures = new Map<string, { count: number; until: number }>();

  constructor(private now: () => number = Date.now) {}

  blocked(email: string) {
    const entry = this.failures.get(email);
    if (!entry) return false;
    if (entry.until <= this.now()) {
      this.failures.delete(email);
      return false;
    }
    return entry.count >= MAX_FAILED_LOGINS;
  }

  fail(email: string) {
    const now = this.now();
    const entry = this.failures.get(email);
    if (entry && entry.until > now) entry.count++;
    else this.failures.set(email, { count: 1, until: now + FAILED_LOGIN_WINDOW_MS });
    if (this.failures.size > MAX_TRACKED) this.prune(now);
  }

  clear(email: string) {
    this.failures.delete(email);
  }

  private prune(now: number) {
    for (const [email, entry] of this.failures) if (entry.until <= now) this.failures.delete(email);
    // Still full of live entries: drop the oldest, rather than grow without limit.
    for (const email of this.failures.keys()) {
      if (this.failures.size <= MAX_TRACKED) break;
      this.failures.delete(email);
    }
  }
}
