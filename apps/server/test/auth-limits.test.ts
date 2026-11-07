import { describe, expect, it } from 'vitest';
import { EMAIL_COOLDOWN_MS, EmailCooldown } from '../src/auth/mail.js';
import { FAILED_LOGIN_WINDOW_MS, LoginLimiter, MAX_FAILED_LOGINS } from '../src/auth/login-limit.js';

describe('email cooldown', () => {
  it('lets one email of a kind through per address, until the wait is over', () => {
    let now = 0;
    const cooldown = new EmailCooldown(() => now);
    expect(cooldown.take('reset', 'a@example.com')).toBe(true);
    expect(cooldown.take('reset', 'a@example.com')).toBe(false);
    expect(cooldown.take('verify', 'a@example.com')).toBe(true); // another kind
    expect(cooldown.take('reset', 'b@example.com')).toBe(true); // another address
    now += EMAIL_COOLDOWN_MS;
    expect(cooldown.take('reset', 'a@example.com')).toBe(true);
  });
});

describe('login limiter', () => {
  it('pauses an account after too many wrong passwords, for the rest of the window', () => {
    let now = 0;
    const limiter = new LoginLimiter(() => now);
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) limiter.fail('a@example.com');
    expect(limiter.blocked('a@example.com')).toBe(false);
    limiter.fail('a@example.com');
    expect(limiter.blocked('a@example.com')).toBe(true);
    expect(limiter.blocked('b@example.com')).toBe(false);
    now += FAILED_LOGIN_WINDOW_MS;
    expect(limiter.blocked('a@example.com')).toBe(false);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) limiter.fail('a@example.com');
    limiter.clear('a@example.com');
    expect(limiter.blocked('a@example.com')).toBe(false);
  });
});
