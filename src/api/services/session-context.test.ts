import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { getSessionContext } from "@/api/services/sessions";

const NOW = 1_700_000_000_000;

function message(
  db: Database,
  sessionID: string,
  messageID: string,
  input: number,
  cacheRead: number
): void {
  db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`, [
    NOW,
    sessionID,
    "message.updated",
    JSON.stringify({ sessionID, messageID, role: "assistant", tokens: { input, cache: { read: cacheRead } } }),
  ]);
}

/** A turn opencode recorded with no token accounting at all. */
function messageWithoutTokens(db: Database, sessionID: string, messageID: string): void {
  db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`, [
    NOW,
    sessionID,
    "message.updated",
    JSON.stringify({ sessionID, messageID, role: "assistant" }),
  ]);
}

function compaction(db: Database, sessionID: string): void {
  db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`, [
    NOW,
    sessionID,
    "session.compacted",
    JSON.stringify({ sessionID }),
  ]);
}

describe("getSessionContext", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => db.close());

  // The whole point of the feature. `input` and `cache.read` are disjoint
  // halves of one prompt; charting `input` alone tracks the delta, not the
  // context, and on real data understated it by roughly 7x.
  it("reports context as input plus cache read, not input alone", () => {
    message(db, "s", "m1", 577, 126_000);

    const [turn] = getSessionContext(db, "s").turns;

    expect(turn!.input).toBe(577);
    expect(turn!.cacheRead).toBe(126_000);
    expect(turn!.context).toBe(126_577);
  });

  it("rates the cached share against the whole prompt", () => {
    message(db, "s", "m1", 100, 900);

    expect(getSessionContext(db, "s").turns[0]!.cacheRate).toBeCloseTo(0.9, 6);
  });

  // session.idle fires once per assistant turn, so opencode re-sends the same
  // message.updated on every later turn. Counting them twice would draw a
  // climb that is repetition, not context growth.
  it("counts a message re-sent across turns once", () => {
    message(db, "s", "m1", 10, 90);
    message(db, "s", "m1", 10, 90);
    message(db, "s", "m2", 20, 80);

    const { turns } = getSessionContext(db, "s");

    expect(turns.length).toBe(2);
    expect(turns.map((t) => t.context)).toEqual([100, 100]);
  });

  it("keeps turns in the order they were recorded", () => {
    message(db, "s", "m1", 1, 0);
    message(db, "s", "m2", 2, 0);
    message(db, "s", "m3", 3, 0);

    expect(getSessionContext(db, "s").turns.map((t) => t.input)).toEqual([1, 2, 3]);
  });

  // Zero compactions is the normal case, not the exception: across 50 real
  // sessions there were none. The series has to stand on its own.
  it("returns a full series and no marks for a session that never compacted", () => {
    message(db, "s", "m1", 10, 0);
    message(db, "s", "m2", 20, 0);

    const result = getSessionContext(db, "s");

    expect(result.turns.length).toBe(2);
    expect(result.compactedBefore).toEqual([]);
    expect(result.peakContext).toBe(20);
  });

  it("marks the compaction before the turn that follows it", () => {
    message(db, "s", "m1", 10, 90);
    message(db, "s", "m2", 20, 80);
    compaction(db, "s");
    message(db, "s", "m3", 30, 70);

    expect(getSessionContext(db, "s").compactedBefore).toEqual([2]);
  });

  // Pinning it to the last turn would draw a drop where nothing was recorded.
  it("drops a compaction that has no turn after it", () => {
    message(db, "s", "m1", 10, 90);
    compaction(db, "s");

    expect(getSessionContext(db, "s").compactedBefore).toEqual([]);
  });

  it("does not mix in another session's turns or compactions", () => {
    message(db, "s", "m1", 10, 0);
    message(db, "other", "m2", 999, 0);
    compaction(db, "other");

    const result = getSessionContext(db, "s");

    expect(result.turns.length).toBe(1);
    expect(result.compactedBefore).toEqual([]);
  });

  // Real shape, from a 213-turn session: opencode records some assistant
  // messages with an explicit all-zero token object (and no `total` field,
  // which every real turn carries). A prompt of zero tokens does not exist, so
  // this is an unmeasured turn wearing zeros — not a context that collapsed.
  it("reports a hole for a turn whose tokens are explicitly all zero", () => {
    message(db, "s", "m1", 2_478, 38_528);
    message(db, "s", "m2", 0, 0);
    message(db, "s", "m3", 128, 44_544);

    const { turns, peakContext } = getSessionContext(db, "s");

    expect(turns[1]!.context).toBeNull();
    expect(turns[1]!.input).toBeNull();
    expect(turns[1]!.cacheRate).toBeNull();
    // The hole keeps its position: turn 2 still exists, it just has no value.
    expect(turns.length).toBe(3);
    expect(peakContext).toBe(44_672);
  });

  // The other spelling of the same thing: the token object is absent entirely.
  it("reports a hole for a turn with no token accounting at all", () => {
    message(db, "s", "m1", 1_000, 400_000);
    messageWithoutTokens(db, "s", "m2");
    message(db, "s", "m3", 1_000, 420_000);

    const { turns, peakContext } = getSessionContext(db, "s");

    expect(turns[1]!.context).toBeNull();
    expect(turns[1]!.input).toBeNull();
    expect(turns[1]!.cacheRate).toBeNull();
    // The hole must not drag the peak down or count as the smallest turn.
    expect(peakContext).toBe(421_000);
  });

  // Half-recorded is different from not recorded: a turn that read nothing from
  // cache genuinely read zero, and that is a real point on the curve.
  it("treats a missing half as zero when the other half is present", () => {
    db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`, [
      NOW,
      "s",
      "message.updated",
      JSON.stringify({ sessionID: "s", messageID: "m1", tokens: { input: 500 } }),
    ]);

    const [turn] = getSessionContext(db, "s").turns;

    expect(turn!.context).toBe(500);
    expect(turn!.cacheRead).toBe(0);
    expect(turn!.cacheRate).toBe(0);
  });

  it("reports an empty series for a session with nothing recorded", () => {
    const result = getSessionContext(db, "unknown");

    expect(result.turns).toEqual([]);
    expect(result.compactedBefore).toEqual([]);
    expect(result.peakContext).toBe(0);
  });
});
