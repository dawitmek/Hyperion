import { describe, expect, it } from 'vitest';
import { currentJar } from '../src/overlay-widgets';

describe('currentJar', () => {
  it('stays on the first jar without a raise', () => {
    expect(currentJar(0, 1000)).toEqual({ jar: 0, from: 0, to: 1000 });
    expect(currentJar(5000, 1000)).toEqual({ jar: 0, from: 0, to: 1000 });
  });

  it('adds the same amount for each jar after the first', () => {
    const plus = { kind: 'plus', by: 500 } as const;
    expect(currentJar(999, 1000, plus)).toEqual({ jar: 0, from: 0, to: 1000 });
    expect(currentJar(1000, 1000, plus)).toEqual({ jar: 1, from: 1000, to: 1500 });
    expect(currentJar(2600, 1000, plus)).toEqual({ jar: 4, from: 2500, to: 3000 });
  });

  it('multiplies the target for each jar', () => {
    const times = { kind: 'times', by: 2 } as const;
    expect(currentJar(1000, 1000, times)).toEqual({ jar: 1, from: 1000, to: 2000 });
    expect(currentJar(4500, 1000, times)).toEqual({ jar: 3, from: 4000, to: 8000 });
    // A small target still grows when multiplying by a little.
    expect(currentJar(3, 1, { kind: 'times', by: 1.25 })).toEqual({ jar: 3, from: 3, to: 4 });
  });

  it('moves once, then stays full', () => {
    const to = { kind: 'to', by: 3000 } as const;
    expect(currentJar(1200, 1000, to)).toEqual({ jar: 1, from: 1000, to: 3000 });
    expect(currentJar(9000, 1000, to)).toEqual({ jar: 1, from: 1000, to: 3000 });
    expect(currentJar(1200, 1000, { kind: 'to', by: 500 })).toEqual({ jar: 0, from: 0, to: 1000 });
  });
});
