# Fix running sessions — evidence

Date: 2026-08-26
Branch: `fix/session-status-resilience`

## Diagnosis verification

The current `src/ingest/session-lifecycle.ts` wrapped reconciliation, the full
session `upsert`, file persistence, and rollup scheduling in one `try/catch`.
On any exception it only logged `Failed to persist session`; there was no
status transition after the row had previously been marked `running` by
`upsertRunning`.

The old database has no `user_messages` column (`PRAGMA table_info(sessions)`),
and the OpenCode log contains these matching failures:

```text
timestamp=2026-08-25T23:41:42.468Z level=ERROR run=136784ee message="Failed to persist session" error="table sessions has no column named user_messages"
timestamp=2026-08-26T02:26:02.659Z level=ERROR run=20dd780e message="Failed to persist session" error="table sessions has no column named user_messages"
```

The event data confirmed `session.ended` rows for `ses_fc6cb5937ffep3AcAhVVp7Urbs`,
`ses_fc41cadffffeKjbKr6egj4iTwS`, and `ses_fc4737b55ffe0Iy56f2DFno5it`.
The two zero-message rows `ses_fc9b46f37ffett8kGE9FN47J1k` and
`ses_fc9b38762ffeBU5MTNE98nV9C7` had no `session.ended` event. The boulder
record shows `ses_fc4737b55ffe0Iy56f2DFno5it` completed and no live OpenCode
process currently owns that session, so it was reconciled rather than left
running. A separate row, `ses_fc40a9db4ffe6seLyTzorDWzax`, is currently running
and was not part of this repair.

## Regression test

`src/ingest/session-lifecycle.test.ts` creates a SQLite trigger that rejects the
full session INSERT. Before the fix, the test failed with `Received: "running"`.
After the fix it passes and asserts `status='idle'`, a numeric `ended_at`, and
the supplied duration.

## Code fix

When the full persistence path fails, `onSessionEnd` now attempts:

```sql
UPDATE sessions SET status = ?, ended_at = ?, duration_ms = ? WHERE id = ?
```

using the session's terminal status, the current timestamp, duration, and ID.
Failure of this final attempt is logged separately.

## Old database reconciliation

Backup created first:

```text
~/.config/opencode/.opencode-metrics/metrics.db.bak-20260826
```

Exact statements executed against **only** the old database:

```sql
BEGIN;
UPDATE sessions SET status='idle', ended_at=created_at, duration_ms=0 WHERE id='ses_fc9b46f37ffett8kGE9FN47J1k' AND status='running';
UPDATE sessions SET status='idle', ended_at=created_at, duration_ms=0 WHERE id='ses_fc9b38762ffeBU5MTNE98nV9C7' AND status='running';
UPDATE sessions SET status='idle', ended_at=1787701302489 WHERE id='ses_fc6cb5937ffep3AcAhVVp7Urbs' AND status='running';
UPDATE sessions SET status='idle', ended_at=1787711163773 WHERE id='ses_fc41cadffffeKjbKr6egj4iTwS' AND status='running';
UPDATE sessions SET status='idle', ended_at=1787712332301 WHERE id='ses_fc4737b55ffe0Iy56f2DFno5it' AND status='running';
COMMIT;
```

The first two use `created_at` because they had zero messages and no end event;
they represent abandoned sessions and are intentionally zero-duration. The
other timestamps are the last `session.ended` event timestamps when available.
Post-repair status counts were `idle=303`, `error=2`, `running=1`; the remaining
running row is the separate live session noted above.

## Verification commands

- `bun test`: 283 passed, 0 failed
- `bun run typecheck`: passed
- `bun run lint`: passed with 9 pre-existing warnings, 0 errors
- `bun run build`: passed; existing chunk-size warning only

## Operational caveats

OpenCode processes booted before the 2026-08-25 19:15 local schema change can
still hold the old plugin module in memory. The user must restart those stale
OpenCode processes to load the current plugin; this task did not restart or
kill any process.

PID 82870 (`opencode-metrics --serve`) is a pre-rename daemon and currently has
the old database open. Do not restart it blindly: a restart with current code
would use the new empty path `~/.local/share/opencode-meter/metrics.db`.
