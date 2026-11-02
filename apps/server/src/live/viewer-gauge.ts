const WINDOW_MS = 60_000;

// The viewer count to judge a stream's size by: the highest of the last minute's readings, so one low reading can't
// make a big stream look small. 0 means TikTok hasn't reported yet. The last reading stands if they stop coming.
export class ViewerGauge {
  private readings: { at: number; count: number }[] = [];

  record(count: number, at: number) {
    if (count <= 0) return; // TikTok's "no count in this message", not an empty room
    this.readings = [...this.readings.filter((r) => at - r.at < WINDOW_MS), { at, count }];
  }

  current(now: number) {
    const recent = this.readings.filter((r) => now - r.at < WINDOW_MS);
    return recent.length > 0 ? Math.max(...recent.map((r) => r.count)) : (this.readings.at(-1)?.count ?? 0);
  }
}
