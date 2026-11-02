import { eq } from 'drizzle-orm';
import type { ActivityKind } from '@hyperion/shared';
import type { Db } from '../db/client.js';
import { streamEvents, streams } from '../db/schema.js';

const FLUSH_MS = 2000;

// Records a stream's events and peak viewer count in batches, so a busy chat isn't one database write per message.
export class StreamRecorder {
  private buffer: (typeof streamEvents.$inferInsert)[] = [];
  private timer = setInterval(() => void this.flush(), FLUSH_MS).unref();
  private writing: Promise<void> = Promise.resolve();
  private peakViewers = 0;
  private savedPeak = 0;

  constructor(
    private db: Db,
    readonly streamId: string,
    private onError: (err: unknown) => void,
  ) {}

  add(kind: ActivityKind, viewer: string | null, data: Record<string, unknown> = {}, at = Date.now()) {
    this.buffer.push({ streamId: this.streamId, at: new Date(at), kind, viewer, data });
  }

  viewers(count: number) {
    this.peakViewers = Math.max(this.peakViewers, count);
  }

  // Writes are chained so batches land in order; a failed batch is reported and dropped rather than retried forever.
  flush(): Promise<void> {
    const peak = this.peakViewers > this.savedPeak ? this.peakViewers : null;
    if (this.buffer.length === 0 && peak === null) return this.writing;
    const rows = this.buffer.splice(0);
    this.savedPeak = this.peakViewers;
    this.writing = this.writing
      .then(async () => {
        if (rows.length > 0) await this.db.insert(streamEvents).values(rows);
        if (peak !== null) await this.db.update(streams).set({ peakViewers: peak }).where(eq(streams.id, this.streamId));
      })
      .catch(this.onError);
    return this.writing;
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
  }
}
