import { describe, expect, it } from 'vitest';
import { ViewerGauge } from '../src/live/viewer-gauge.js';

describe('ViewerGauge', () => {
  it('knows nothing until a real count arrives', () => {
    const gauge = new ViewerGauge();
    expect(gauge.current(0)).toBe(0);
    gauge.record(0, 1000);
    expect(gauge.current(1000)).toBe(0);
  });

  it('ignores a message with no count', () => {
    const gauge = new ViewerGauge();
    gauge.record(700, 0);
    gauge.record(0, 1000);
    expect(gauge.current(1000)).toBe(700);
  });

  it("doesn't let one low reading make a big stream look small", () => {
    const gauge = new ViewerGauge();
    gauge.record(700, 0);
    gauge.record(3, 5000);
    expect(gauge.current(5000)).toBe(700);
  });

  it('follows a real drop after a minute of low readings', () => {
    const gauge = new ViewerGauge();
    gauge.record(700, 0);
    gauge.record(20, 30_000);
    gauge.record(20, 61_000);
    expect(gauge.current(61_000)).toBe(20);
  });

  it('keeps the last count if readings stop', () => {
    const gauge = new ViewerGauge();
    gauge.record(700, 0);
    expect(gauge.current(10 * 60_000)).toBe(700);
  });
});
