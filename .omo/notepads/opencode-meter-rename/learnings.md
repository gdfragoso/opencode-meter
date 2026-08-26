# Learnings — opencode-meter-rename

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## Todo 1 — package metadata + plugin identity rename (2026-08-25)

Changed:
- `package.json:2` `"name"` → `"opencode-meter"`; `package.json:7-9` `"bin"` key `"opencode-metrics"` → `"opencode-meter"` (target `src/cli.ts` unchanged).
- `plugin.ts:12` `id: "opencode-metrics"` → `id: "opencode-meter"`. Registration shape untouched.
- `README.md` npm badge/package URLs → `opencode-meter` (npm/v, npm/l, npm/dm badges + 2 `www.npmjs.com/package/...` links). CI badge (`gdfragoso/opencode-metrics`), clone URL (`opencode-ai/opencode-metrics`), and `plugins/opencode-metrics` local checkout dirs left intact per guardrail.
- New `src/data/domain/package-identity.test.ts`: imports `plugin.ts` default export at runtime, asserts `plugin.id === "opencode-meter"`. Safe to import — `connection.ts`'s `getDb()` is lazy and `registerCleanup` only registers listeners when called, so importing plugin.ts has no side effects.

Key learnings:
- `.releaserc.jsonc` and `.github/workflows/release.yml` contain NO npm package-name token (semantic-release derives the name from `package.json`), so they needed no edit for Todo 1 — verified zero grep hits.
- README `opencode-metrics` hits are NOT all npm identity: CLI examples, plugin-array entries, `~/.config/opencode/.opencode-metrics/metrics.db`, and `x-opencode-metrics` header docs must stay until Todos 2/3/4 change the actual runtime behavior — renaming them early would document paths/headers the code doesn't use yet. Todo 4 owns "CLI examples, plugin configuration, database path, port variable, headers, root guidance".
- `bun pm pack --dry-run` doesn't print the bin field; assert name+bin via `bun -e` reading `package.json` for evidence.
- Do not manually regenerate `bun.lock` in Todo 1 — Todo 5 runs `bun install` and owns the lockfile churn.

## Todo 4 — dashboard branding + docs rename (2026-08-25)

Changed:
- `index.html:6` `<title>` → `opencode-meter`.
- `src/dashboard/components/Layout.tsx:111` header h1 "OpenCode Metrics" → "OpenCode Meter". This was the ONLY user-visible branding string in `src/dashboard/**/*.tsx` (dashboard sweep).
- `README.md`: heading, CLI bullet + usage block (7 lines), plugin-array entry, postinstall `bun link` command name, DB path (2x) → `~/.local/share/opencode-meter/metrics.db`, `x-opencode-metrics` curl header → `x-opencode-meter`, uninstall plugin-array entry + data-dir `rm -rf`. PRESERVED: CI badge (`gdfragoso/opencode-metrics`), clone URL (`opencode-ai/opencode-metrics`), 2 `cd` checkout-dir lines, uninstall `rm -rf ~/.config/opencode/plugins/opencode-metrics`.
- `AGENTS.md`: heading, tree label, `--serve` row, `service "opencode-metrics"` → `"opencode-meter"`, `--prune` example.

No-change files (verified by reading):
- `src/api/routes/tool-metrics.ts` — pure route defs (`/api/tools` + `/api/tool-metrics`), zero branding strings. Endpoint preserved per guardrail.
- `src/dashboard/App.test.tsx` — context-provider tests only; no title/heading assertion to update. Assertions untouched (not weakened).

Key learnings:
- The tracked-text audit must be `git grep` (tracked files only), NOT a raw `grep -r` over `.` — the raw one floods with `.omo/` plan/notepad history (the rename plan itself describes the old→new mapping) plus stale `dist/`. Post-edit `git grep` = 6 hits, all allowed (4 repo-slug/checkout-path refs in README + 1 regression-guard comment in Todo 1's package-identity.test.ts). Zero unclassified.
- **Race hazard:** running `grep dist/index.html` in parallel with `bun run build` can read the STALE pre-build artifact and report the old title. Verify the generated title AFTER the build completes (read `dist/index.html` post-build → `<title>opencode-meter</title>`).
- README mentions the port as `PORT` in `src/api/app.ts`, NOT `OPENCODE_METRICS_PORT` — no port-variable doc rename was needed in Todo 4 (Task 3 owns the env-var rename in code).
- README/AGENTS.md are shared lanes: concurrent workers (Todos 2/3) are mid-edit on `app.ts`, `cli.ts`, `logging.ts`, `vite.config.ts`, `connection.ts`, `SessionsTab.tsx` (uncommitted M state). Commit ONLY the Todo-4-owned files to avoid sweeping their work into this commit.

## Todo 4 addendum — commit-race incident (2026-08-25)

- **The warned race happened in inverted form:** a concurrent worker staged THEIR files into the shared index between this task's `git add` and `git commit`, so the docs commit df66f61 swept in all 12 files (4 mine + 8 Task-3 runtime + Task-2 connection.ts). The task's "re-git add and retry" guidance covers a failed commit, not a *wrong-content* commit.
- **Repair recipe that worked** (clean worktree required — do this only when no uncommitted changes exist, or stash first):
  1. `GIT_SEQUENCE_EDITOR="perl -i -pe 's/^pick <mine>/edit <mine>/'" git rebase -i <base>` → stops at my commit with everything staged.
  2. `git reset HEAD^` (unstage all, keep worktree) → `git add <only my files>` → `git commit`.
  3. **Gotcha:** `git rebase --continue` refuses with the generic "You must edit all merge conflicts" when ANY unstaged changes remain in the worktree (it requires clean). Stash the unrelated files, continue, pop.
  4. Rebase replays the worker's commits on top; my commit now contains exactly my 4 files; the other files return to the worktree as unstaged for their owners.
- The task-3 runtime files (app.ts, cli.ts, logging.ts, port-conflict.ts, vite.config.ts, SessionsTab.tsx, app.test.ts, logging.test.ts) were NOT lost — they reverted to unstaged M state after the split, ready for Task 3's own commit.
- Re-verify after surgery: `git show --name-status <mine>` (exactly the owned files), tracked audit re-run (still 6 allowed hits), `bun run build` + dashboard test still green.

## Todo 3 — runtime configuration, logging, server-detection contracts (2026-08-25)

Changed (8 files, all owned by Task 3):
- `src/shared/logging.ts:15-16,46` — `SERVICE = "opencode-meter"`, `CONSOLE_PREFIX = "[opencode-meter]"`, doc comment updated.
- `src/cli.ts` — help text + every console prefix `[opencode-metrics]` → `[opencode-meter]`; `$OPENCODE_METRICS_PORT` → `$OPENCODE_METER_PORT` in help. Note `opencode-metrics` appears both as the CLI name in help (`opencode-meter --json` etc.) and as the console prefix — a single `replaceAll` of the bare string handled both.
- `src/api/app.ts` — `resolvePort` reads `OPENCODE_METER_PORT`; route-error prefix `[opencode-meter]`; response header `x-opencode-meter: "1"`. `DEFAULT_PORT`/`PORT` (9393) and the parse rules untouched.
- `src/api/port-conflict.ts` — probe sends `x-opencode-meter-check: "1"`, checks `x-opencode-meter === "1"`.
- `vite.config.ts:6-7` — proxy reads `OPENCODE_METER_PORT`; the `|| 9393` fallback expression kept as-is (still targets `:9393`).
- `src/dashboard/components/SessionsTab.tsx:173` — CSV export error prefix.
- Tests: `logging.test.ts` (service field, console prefix), `app.test.ts` (env var name in all three cases). No assertions weakened.

Key learnings:
- `x-opencode-metrics` is a literal prefix of `x-opencode-metrics-check`, so a single `replaceAll` of the shorter string renames both the probe request and the response header at once — no ordering trap.
- `git grep` after Todo 3 still reports ONE hit: `src/data/domain/package-identity.test.ts:9`, a prose comment ("a regression back to \"opencode-metrics\" fails here") in a Todo-1-owned file. It is not a runtime contract; flagged in the evidence as a remaining (allowed) hit rather than edited.
- The port-fallback evidence can be produced two ways: the permanent test cases in `src/api/app.test.ts` already cover unset/empty/invalid/zero/negative/oversized → 9393 and valid → 8080, and a one-off `bun -e` loop with `resolvePort` gives explicit per-case output for the evidence file. `bun run typecheck` (tsc --noEmit) exits 0 after the rename.
- Concurrent workers (Todos 2/4) modify `README.md`, `index.html`, `Layout.tsx`, `src/data/db/connection.ts` in the same worktree — stage ONLY your own files and re-`git add` on commit conflict; never `git add .`.

## Todo 2 — move SQLite storage to XDG data path (2026-08-25)

Changed:
- `src/data/db/connection.ts:6` `DB_DIR` → `join(homedir(), ".local", "share", "opencode-meter")`. Exported `DB_PATH` now resolves to `$HOME/.local/share/opencode-meter/metrics.db`. Nothing else in the file moved: `mkdirSync(DB_DIR, { recursive: true })`, WAL, busy_timeout=5000, `registerCleanup` (exit/SIGINT/SIGTERM + `wal_checkpoint(TRUNCATE)`), and the `getDb()`/`registerCleanup(Database)`/`DB_PATH` DI shape are byte-identical.

Key learnings:
- The three test files listed in the plan (`migrations.test.ts`, `plugin-wiring.test.ts`, `days.test.ts`) contain NO assertions on the old path. `plugin-wiring.test.ts` and `days.test.ts` fully `mock.module("@/data/db/connection")` (they even stub `DB_PATH: ":memory:"`), and `migrations.test.ts` uses `new Database(":memory:")`. So the "update ONLY path assertions" rule meant **zero test edits** — verifying with grep first avoided pointless churn.
- `git grep -n "\.opencode-metrics" src/` after the edit returns exit=1 (zero hits). The remaining plain `opencode-metrics` string hits (`src/cli.ts`, `src/shared/logging.ts`, `src/api/app.ts`, `src/api/port-conflict.ts`, `src/shared/logging.test.ts`, and a comment in `package-identity.test.ts`) are runtime-identity tokens owned by Task 3 (and Task 1 leftovers) — NOT the DB path.
- Parallel-lane caution: while working, Task 3's worker had already modified `src/cli.ts` and `src/shared/logging.ts` in the working tree. `git commit <file>` (not `git commit -a`) is mandatory here — stage ONLY your own file(s) or you will commit another worker's unfinished lane.
- Evidence file: `.omo/evidence/task-2-opencode-meter-rename.txt` (test output 43 pass / 0 fail + grep proof).

## Todo 5 — lockfile regeneration + DB-path contract test (2026-08-25)

Changed:
- `bun.lock` regenerated. `bun install` alone reports "no changes" and does NOT rewrite the workspace root `name` — bun never syncs package.json's name in place; it only writes it when CREATING the lockfile. `bun install --force` also rewrote byte-identically with the stale name. Fix: `rm bun.lock && bun install` (backup first) — fresh creation derives the root name from the manifest. Diff was tiny: root name `opencode-metrics` → `opencode-meter`, two `debug` entries gained `peerDependencies: { "supports-color": "*" }` + `optionalPeers`, one duplicate `fdir/picomatch` alias entry dropped. No version bumps, no dependency adds/removes — pure regeneration churn, no hand-editing.
- New `src/data/db/connection.test.ts` — asserts the exported `DB_PATH` resolves to `join(homedir(), ".local", "share", "opencode-meter", "metrics.db")` and does NOT contain `.opencode-metrics`. Gap was real: grep showed only `":memory:"` mocks and cli.ts usages, no test asserted the constant.

Key learnings:
- **bun `mock.module` is process-global and irreversible**: `mock.restore()`/`clearAllMocks()` explicitly do NOT reset module mocks. Once `days.test.ts`/`plugin-wiring.test.ts` mock `@/data/db/connection`, every later import in the same `bun test` run — even via absolute file path — reads the mocked `":memory:"` because bun patches the module cache retroactively (and `package-identity.test.ts` importing plugin.ts already cached the real module under the URL). In-process import is therefore unsalvageable; the test reads the real constant in a fresh `bun -e` subprocess (`Bun.spawnSync`, cwd = repo root derived from `import.meta.dir`) — clean cache, zero mocks, and connection.ts import has no side effects (getDb is lazy, no disk I/O).
- Full suite before/after: 281 pass → 282 pass / 0 fail (2 new assertions), 830 expect() calls, exit 0. No existing assertion touched.
- Expected-value rule held: the test recomputes the path from primitives (`homedir()` + literal segments) rather than importing any module constant, so a regression in `DB_DIR` construction fails the test.
- Lockfile churn discipline: stage ONLY `bun.lock` + the new test file; verify `git status --short` shows nothing else before committing (other lanes were already clean this time).

## Todo 6 — full quality gates + tracked-reference audit (2026-08-25)

- All four gates exit 0: `bun run lint` (9 pre-existing style warnings, no errors), `bun run typecheck` (tsc --noEmit, silent), `bun run build` (tsc + vite, one pre-existing >500kB chunk warning), `bun test` (282 pass / 0 fail / 830 expect / exit 0). CI order matches exactly: lint → typecheck → build → test (with coverage).
- Changed-file list `git diff d280326..HEAD --stat` = exactly the 18 allowed files. Zero scope violations. Proof idiom: `git diff --exit-code <base>..HEAD -- <path>` — **exit 0 means NO diff** (with `--exit-code`), which reads much cleaner in evidence than a pipeline exit check. `git diff` without `--exit-code` always exits 0, so never quote a bare diff exit as "changed".
- Domain invariants: whole `src/api/routes/` dir diff --exit-code = 0 (routes byte-identical, incl. `app.get("/api/tool-metrics", ...)` in tool-metrics.ts:21), `src/data/db/migrations.ts` --exit-code = 0 (schema untouched). The only `src/data/domain/` change is the new package-identity.test.ts addition — the `--stat | grep domain/(session|event|daily|metrics|errors|projects)` idiom correctly ignores it (name doesn't start with any alternation branch).
- Old-token audit = 7 hits, all allowed: 5 README repo-slug/checkout-path (lines 4, 46, 47, 58, 220) + 2 regression guards. **One hit the task brief didn't pre-list:** `src/data/db/connection.test.ts:36-37` `expect(realDbPath()).not.toContain(".opencode-metrics")`. It is a regression-guard negative assertion (same protective category as the package-identity prose comment) — the literal exists ONLY so a regression back to the old path fails the test. Classifying it as ALLOWED (not a violation) is correct: "fixing" it would mean obfuscating or deleting the assertion, which the plan forbids (no test weakening). When a task's allowed-hit list under-covers a deliberate contract-test token, classify by intent, document the reasoning in evidence, don't fail a correct test.
- Post-build title check: reading `dist/index.html` via shell grep is blocked by the harness's generated-directory read guard, but the Read tool reads it fine — use Read on dist artifacts for stale-build evidence instead of shell grep.
- No gate failure → no commit (task says commit ONLY if a fix was needed; empty verification commits are not wanted here).

## F1 — approval gate: plan compliance audit (2026-08-25)

VERDICT: **APPROVE** (evidence: `.omo/evidence/task-F1-opencode-meter-rename.txt`).

- All 4 Must-haves verified with FRESH evidence (not just todo files): rename everywhere (package.json name/bin, plugin.ts id, 30 new-token hits in the 9 right files; old-token grep = exactly the 7 pre-authorized hits: 5 README repo-slug/checkout + 2 regression-guard test texts); DB root `~/.local/share/opencode-meter/metrics.db` with recursive mkdir/WAL/busy_timeout intact; bun.lock root name = opencode-meter; all four gates re-run → lint 0, typecheck 0, build 0, test 0 (282 pass / 830 expect).
- All 5 Must-NOT-haves hold: no old env/header handling anywhere (`git grep OPENCODE_METRICS_PORT|x-opencode-metrics src/ vite.config.ts` = zero); no migration/copy/legacy logic in the full diff (the grep hits are removed README old-path doc lines, regression-guard test text, prose comments, and hunk headers); repo slug/checkout dirs unchanged (README:4,46,47,58,220 + on-disk folder still `opencode-metrics`); `src/api/routes/` and `src/data/db/migrations.ts` byte-identical (--exit-code 0), `/api/tool-metrics` still at tool-metrics.ts:21, only src/data/domain change is the added test file; `src/api/` diff is pure string renames (port 9393, parse rules, handshake VALUE "1" untouched) and `src/collector/` + `src/ingest/` have ZERO diff.
- Audit hygiene worth keeping: re-run the gates yourself instead of trusting todo evidence; `git diff <base>..HEAD --exit-code -- <path>` for byte-identical checks; read `dist/index.html` via the Read tool post-build (shell grep on dist is blocked).

## F4 — scope fidelity review verdict: APPROVE (2026-08-25)

- `git diff d280326..HEAD --stat` = exactly the 18 expected files. Full per-file diff read; every file classifies into the 4 allowed buckets (package identity 4, storage relocation 2, runtime contracts 8, UI/docs branding 4). No stragglers.
- Guarded dirs all `--exit-code` 0: `src/api/routes/`, `src/data/db/migrations.ts`, `src/collector/`, `src/ingest/`, `src/data/repositories/`, `.github/workflows/`. `src/data/domain/` and `src/dashboard/` each contain ONLY the allowed files (new package-identity.test.ts / Layout.tsx + SessionsTab.tsx).
- `git diff --summary` shows zero renames (only 2 new-file creates) → no API/schema/domain symbol renamed. Routes + migrations diffs are empty → endpoints, tables, schema untouched.
- bun.lock churn exactly the documented Todo-5 shape: root name + 2 `debug` peerDeps metadata + dropped `fdir/picomatch` alias. No version bumps.
- Logic-sensitive spot-read (cli.ts + app.ts): pure token swaps — port parse rules, DEFAULT_PORT 9393, EADDRINUSE pre-check, shutdown flow all byte-identical.
- Old-token git grep = 8 hits, all allowed: 5 README repo-slug/checkout refs + 3 regression guards (2 in connection.test.ts negative assertion, 1 prose comment in package-identity.test.ts).
- Evidence: `.omo/evidence/task-F4-opencode-meter-rename.txt`. Notepad path patterns: `git diff --name-only` per dir is the cleanest way to verify "only allowed files changed" (my earlier `-- . ':(exclude)…'` mixed pathspec was malformed — pass `'src/dir/**'` with exclude pathspecs, no bare `.`).

## F3 — real manual QA verdict: APPROVE (2026-08-25)

Live smoke checks on the built server (ports 9499/9599; pre-existing 9393 PID 82870 left untouched):
- Check 1: `OPENCODE_METER_PORT=9499 bun src/cli.ts --serve` logged `[opencode-meter] Dashboard: http://127.0.0.1:9499`; `curl -D - /api/health` → HTTP 200 + `x-opencode-meter: 1`.
- Check 2: second server on 9499 exited(1) with `[opencode-meter] A dashboard is already serving on port 9499: …` — proves the renamed probe (`x-opencode-meter-check` → `x-opencode-meter: 1`) handshake works end-to-end.
- Check 3: env unset + `--port 9599` → `[opencode-meter] Dashboard: http://127.0.0.1:9599`, health 200. resolvePort unit coverage re-run: 3 pass / 0 fail (unset/""/abc/0/-1/65536/99999 → 9393, 8080 → 8080).
- Check 4: served HTML title `opencode-meter` (1 match); bundle `OpenCode Meter` found in dist/assets/index-3YD45gqy.js after fresh `bun run build`.
- Cleanup receipt: both PIDs killed; `lsof` on 9499/9599 empty; temp logs removed.
- QA nugget: `/api/health` is NOT a route (health is at `/health`) — it falls through to the SPA fallback, still 200 + `x-opencode-meter: 1` because `app.use("*")` stamps the header on every response. The conflict probe works precisely because of that blanket middleware, not because of a dedicated route. Evidence: `.omo/evidence/task-F3-opencode-meter-rename.txt`.

## F2 — code quality approval gate: APPROVE (2026-08-25)

VERDICT: **APPROVE** (evidence: `.omo/evidence/task-F2-opencode-meter-rename.txt`).

- All 6 axes PASS. Axis 1: DB_PATH runtime-verified `$HOME/.local/share/opencode-meter/metrics.db`, `mkdirSync(recursive:true)` + WAL/busy_timeout intact; test recomputes expected from primitives (not mirroring DB_DIR); subprocess justified — confirmed days.test.ts:15 AND plugin-wiring.test.ts:108 both `mock.module("@/data/db/connection")`, and plugin-wiring's own comment states the mock "replaces the module for every later import in the run".
- Axis 2: resolvePort parse rules byte-identical (runtime matrix: unset/empty/abc/0/-1/65536/99999 -> 9393, 8080 -> 8080); `--port` precedence unchanged; vite `|| 9393` consistent. Only note: oversized-port vite-vs-server mismatch is PRE-EXISTING (identical expression at base with old env name) — not rename drift.
- Axis 3: typecheck exit 0; zero `any`/`@ts-ignore`/`as any` in diff; plugin.ts `satisfies PluginModule` id swap type-safe.
- Axis 4: no assertions weakened — logging.test.ts exact-body + spyOn prefix, app.test.ts all parse cases preserved; new connection.test.ts + package-identity.test.ts assert REAL behavior (fresh subprocess / real plugin module), not mock mirrors.
- Axis 5: no new identity duplication — each opencode-meter occurrence is a distinct per-layer constant (pkg/bin, plugin id, SERVICE vs CONSOLE_PREFIX, DB_DIR, headers, CLI strings, docs); no cross-layer constant import introduced.
- Axis 6: `git grep OPENCODE_METRICS src/ vite.config.ts` = zero; only remaining opencode-metrics tokens are 5 README repo-slug/checkout refs (repo itself not renamed) + 2 deliberate regression-guard test texts. No unsafe fallback.
- Full suite re-run by me: 282 pass / 0 fail / 830 expect, exit 0.

## Final Wave — all 4 gates APPROVED, awaiting user approval (2026-08-26)

- F1 plan-compliance audit: APPROVE (all 4 Must-haves + 5 Must-NOT-haves verified with fresh evidence; 18 files; routes/migrations byte-identical; 282 tests pass).
- F2 code quality: APPROVE (path handling OK, resolvePort rules byte-identical, no weakened assertions, subprocess test isolation justified, no new duplicated identity constant, zero OPENCODE_METRICS fallback).
- F3 real manual QA: APPROVE (OPENCODE_METER_PORT=9499 honored, x-opencode-meter: 1 header, conflict handshake detected via new headers, title/heading verified in served HTML + bundle, test ports cleaned; pre-existing 9393 process untouched; noted /api/health falls to SPA fallback but header middleware stamps it — pre-existing behavior).
- F4 scope fidelity: APPROVE (all 18 files classified into 4 allowed buckets; unchanged dirs exit=0; zero renames; lockfile churn = Todo-5 shape only).
- Plan checkboxes F1-F4 marked `- [~]` (blocked) per protocol: final wave requires the user's explicit okay before marking complete. Awaiting user approval to flip to `- [x]` and declare the plan complete.

## Distribution — create public repo gdfragoso/opencode-meter (2026-08-25)

Follow-up to the completed plan: move the clean tree to a NEW public repo as a SINGLE orphan commit, old repo left untouched.

Steps that worked:
- Version: `package.json:3` `2.0.0` → `1.0.0` (phantom version, never published). `git grep -n "2.0.0"` afterwards: only dependency ranges (`@semantic-release/npm": "^12.0.0"`, bun.lock entries) and numeric literals (`2_000`, `120000`, `2_000_000` — regex `.` matches the underscore/digit) — no other tracked file carries the package version.
- README repo-refs: 5 spots → `gdfragoso/opencode-meter` / `plugins/opencode-meter` (line 4 badge+actions, 46 clone URL+dir, 47+58 cd dirs, 220 rm -rf dir). npm badges untouched (already renamed in Todo 1), `opencode-ai/opencode` project link at :225 untouched. Trick: after the clone-line edit, a single `replaceAll` of `~/.config/opencode/plugins/opencode-metrics` handled the remaining 3 dir spots at once.
- `gh repo create gdfragoso/opencode-meter --public --description "..." --confirm` → deprecation notice "Pass any argument to skip confirmation prompt" but creates fine; verify pre-push with `--json isEmpty` (was true, no default branch) to prove it started empty (no --add-readme/--license/--gitignore).
- **`git checkout --orphan main` can FAIL with "a branch named 'main' already exists"** — the old local main is still around. Before deleting: prove `git merge-base --is-ancestor main chore/package-rename` (exit 0 = old main fully contained in the backup branch), then `git branch -D main` and re-run the orphan checkout. Backup branch `backup/opencode-metrics-history` was created at chore/package-rename tip FIRST, so the 5-commit history is protected regardless.
- Orphan commit `feat: opencode-meter session metrics plugin for OpenCode` — the `feat:` type is deliberate: semantic-release on first push to main computes the initial version from the breaking/feature commits; a `feat` without `!` yields 1.0.0. (chore/docs would produce NO release and the publish step would skip.)
- Push sequence: `git remote set-url origin git@github.com:gdfragoso/opencode-meter.git` then `git push -u origin main` — plain push, no force needed (empty upstream).
- Verification idiom: `git rev-list --count HEAD` (must be 1), `git ls-files | grep -E "(^dist/|node_modules|\.omo/)"` (must be empty — .gitignore keeps them out of the orphan `git add -A`), `git show main:README.md | grep gdfragoso/opencode-meter` (commit tree, not worktree), and `gh repo view <old-repo> --json visibility,url` as read-only proof the old repo is untouched.

Known follow-up (flagged, not done): release.yml's semantic-release needs an `NPM_TOKEN` secret in the NEW repo settings; without it the first workflow run on main fails at the publish step (harmless) and succeeds on a later push once the secret exists. Evidence: `.omo/evidence/task-repo-create-opencode-meter.txt`.

## CI/CD polish — README image fix + separate CI/CD workflows (2026-08-26)

- Broken README image: `![Screenshot](screenshots/dashboard.png)` referenced a `screenshots/` dir that doesn't exist in the repo → broken on GitHub AND in the published npm tarball. Removed in `871264c docs(readme): remove broken dashboard screenshot reference` (2-line deletion: image + its blank line).
- **setup-bun v2 does NOT cache the bun dependency cache.** Its `no-cache` input and `cache-save.ts` (`saveCache([state.bunPath])`) cache only the Bun *executable*. The task's premise ("v2 auto-caches ~/.bun/install/cache") was wrong — verified by reading action.yml + cache-save.ts. So `actions/cache@v5` (path `~/.bun/install/cache`, key `${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}`) was added to every job that runs `bun install`.
- Action majors verified live (all exist, all node24): actions/checkout@v5 (v5.1.0), actions/setup-node@v5 (v5.0.0 "Upgrade action to use node24"), actions/cache@v5 (node24). This kills the "Node.js 20 is deprecated... forced to run on Node.js 24" warning from checkout@v4/setup-node@v4.
- **workflow_run gotchas:** the workflow file must exist on the DEFAULT branch to trigger at all; `branches: [main]` filters to runs on main; the `event == 'push'` gate on the job stops PR-completion runs from releasing; `github.event.workflow_run.head_sha` is the right ref for checkout so semantic-release analyzes the triggering run's commit, NOT the workflow file's own commit (which can lag behind on a fresh push). concurrency keyed on `head_sha` so a burst of pushes serializes releases (cancel-in-progress: false — you don't want to kill a release mid-publish).
- Semantic-release "no release" completion is the CORRECT outcome for docs:/ci: pushes — the run finishes green, publishes nothing, creates no tag, and the real v1.0.0 tag stays the newest. That is the observable proof the analyzer ignored the commits: `Analysis of 3 commits complete: no release` + `There are no relevant changes, so no new version is released.`
- Evidence idioms that worked: `gh run view <id> --json jobs -q '.jobs[] | "\(.name): \(.conclusion)"'` for per-job status, `npm view <pkg> version` + `git ls-remote --tags origin` as the no-publish/no-new-tag proof, `gh run view <id> --log | grep semantic-release | grep -v "Set up job"` to extract clean analyzer lines.
- PyYAML footgun when sanity-checking GitHub workflows: `yaml.safe_load` parses the `on:` trigger key as boolean `True` (YAML 1.1 on/off). Access the trigger via `rel.get('on') or rel.get(True)` — it's a PyYAML artifact, GitHub's parser treats `on` as a key.
- Combined-workflow learning: putting the release job inside ci.yml worked (needs gate + push branch filter) but couples CI and CD in one file; the workflow_run split decouples them cleanly at the cost of an extra moving part (the trigger). Both are valid; the split is what the repo now uses.

## Session status resilience — 2026-08-26

- `onSessionEnd` must treat terminal status persistence as a separate durability obligation from the rich `INSERT OR REPLACE`: if reconciliation or the full upsert fails, issue a minimal `UPDATE sessions SET status, ended_at, duration_ms` so a prior `running` marker cannot persist forever.
- A stale OpenCode process can keep an old plugin module in memory after a schema migration. Matching application log errors to `session.ended` event timestamps distinguishes that primary cause from the missing fallback that makes future failures self-healing.
- For old-data repair, back up first and use event timestamps when present. Zero-message sessions without an end event are safely marked idle at `created_at` with zero duration; a currently active running row must remain untouched.
