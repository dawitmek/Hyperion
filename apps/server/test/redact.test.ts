import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/redact.js';

describe('request log', () => {
  it('leaves overlay tokens out of logged URLs', () => {
    expect(redactUrl('/overlay/abc123secret')).toBe('/overlay/[redacted]');
    expect(redactUrl('/overlay/abc123secret?x=1')).toBe('/overlay/[redacted]?x=1');
    expect(redactUrl('/ws/overlay?token=abc123secret&dashboard=1')).toBe('/ws/overlay?token=[redacted]&dashboard=1');
    expect(redactUrl('/ws/overlay?dashboard=1&token=abc123secret')).toBe('/ws/overlay?dashboard=1&token=[redacted]');
    expect(redactUrl('/api/media/123')).toBe('/api/media/123');
  });
});
