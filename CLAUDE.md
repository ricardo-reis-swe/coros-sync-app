# CLAUDE.md — Coros Sync App

An Electron desktop app: import local media → transcode to mp3 (bundled ffmpeg) →
sync onto a Coros watch over USB.

**The architecture is already designed.** This repo is an _implementation_ of an
existing design, not a place to re-derive it.

---

## 1. Where the design lives

Three files. That is the whole design set.

```
docs/
  CONTRACTS.md      ★ the seams — schema, IPC, adapters, settings. The default read.
  DECISIONS.md      ★ 53 decisions, one line each + what breaks if you reverse one,
                      + the supersessions and the open questions
  ARCHITECTURE.md     how the program works — scope, tiers, data model, runtime and
                      failure paths, cross-cutting, packaging, the screen
```

**Read `CONTRACTS.md`, then §3 below, then start.** Most sessions need nothing else.
Open `ARCHITECTURE.md` for the _reasoning_ behind a seam; it does not restate shapes.

**The ADR bodies were removed on 2026-08-22** and live in git history — they are the
only record of the *rejected* options, which is the one thing no surviving file
carries. `DECISIONS.md` keeps every number resolvable (~310 code comments cite one),
and its *Purpose* section has the two commands that retrieve a body. Retrieve it
rather than re-deriving a decision from scratch.

| Working on…                        | Read                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| The shape of any seam              | `CONTRACTS.md`                                           |
| First time in a session            | `DECISIONS.md`                                           |
| Coordinators, queue, tiering       | ADR-0004, ADR-0008 · ARCHITECTURE §4                     |
| Cancellation (queue or item)       | ADR-0023 (+ ADR-0003 for what cancel is *not*) · §7.2    |
| Schema, entities, lifecycle        | ADR-0005, ADR-0006, ADR-0007, ADR-0021 · §6              |
| Deleting an item from the library  | ADR-0022 (+ ADR-0003's cleanup primitive)                |
| ffmpeg / probe / transcode         | ADR-0002, ADR-0003, ADR-0008 · §7.1                      |
| Device / sync / scan               | ADR-0001, ADR-0009, ADR-0010, ADR-0016, ADR-0038 · §7.3–7.4 |
| IPC, preload, renderer state       | ADR-0011, ADR-0024 · §5                                  |
| Anything on screen                 | ARCHITECTURE §10                                         |
| Settings, logging                  | ADR-0012, ADR-0013, ADR-0024 · §8                        |
| Cancelling a running sync          | ADR-0025 (**not** ADR-0023 — different mechanism)        |
| Packaging, binaries, native module | ADR-0014 · §9                                            |
| A failure path (any)               | ARCHITECTURE §7 — half of it is failures, on purpose     |

**Precedence:**

```
docs/DECISIONS.md  >  docs/CONTRACTS.md  >  docs/ARCHITECTURE.md  >  the code
```

Decisions always win. Below them, CONTRACTS.md is authoritative for _shape_ and
ARCHITECTURE.md for _reasoning_. If the code contradicts any of them, say so and name
the ADR; never silently follow the code.

---

## 2. How a session runs

1. **I name the slice** (or ask you to propose the next one).
2. **You scope it**: what it touches, which ADRs constrain it, what "done" means.
   Small enough to finish in one sitting. One seam at a time.
3. **Acceptance criteria** — concrete and checkable, phrased as behaviour or
   invariants, not as a file list.
4. **Build it**, review against §3, then stop and show me. Committing is my call (§5).

Rules:

- **One question at a time.** Not a questionnaire.
- **Options → tradeoffs → recommendation → my call** whenever there is a genuine
  choice. 2–3 realistic options and your pick with reasoning.
- **Push back** on gold-plating, speculative generality, and premature abstraction.
  The design is deliberately small. A plugin system, a second concurrency knob, or a
  `Collection` table means something has gone wrong.
- **Short beats thorough.** The sharp edge, not a recap.

**Where the build stands.** `ARCHITECTURE.md §11`, and the open questions in
`DECISIONS.md §4` — which is where the remaining unknowns actually live, including the
three unrun playback-order phases that ADR-0019 cannot leave Proposed without (§4
carries the procedure itself, since the spike file is gone).

Current work is the **walking skeleton**: import one file → probe → one transcode →
one Output row → scan device → transfer one file → `onWatch = true`. No fan-out, no
UI polish, no reorder-all. Everything else widens that path.

---

## 3. The invariants — the review checklist

Load-bearing. A violation is not a style nit; it is the design failing quietly.
Check every diff against them. For what *breaks* if one is reversed, see
`DECISIONS.md §3` — that table is the negative form of this list.

### Structure

- **Dependencies point one way: edge → domain → infrastructure.** Infrastructure
  never calls a coordinator; it reports upward via events/promises. (ADR-0004)
- **Lifecycle ownership is per _column_**: `items.state` is Processing's;
  `outputs.onWatch` is Sync's. Row creation and deletion in **both** tables belong to
  Processing. Sync never inserts, never deletes, never touches another column.
  (ADR-0021, superseding the table-partition wording in 0005/0007)
- **The Job Queue is domain-ignorant.** A limit, a list, a group key. Never sees
  SQLite, never knows the word `imported`. (ADR-0004 / ADR-0008)
- **Main is never in the byte path.** ffmpeg reads the source and writes the mp3s.
  Main passes paths and watches exit codes. (ADR-0003)
- **One adapter per foreign world.** ffmpeg CLI ugliness stops in the Engine Adapter,
  device ugliness in the Device Adapter, all SQL in the Repository.

### Data

- **Three tables: `items`, `outputs`, `settings`.** Jobs, transfer sessions and
  device scans are in-memory only. (ADR-0007)
- **Rows follow reality.** An Output row is written _after_ the child exits 0 and the
  file provably exists — never in anticipation. (ADR-0007)
- **There is no `failed` state.** Failure = clean up all of that item's outputs
  (**by directory/prefix, not by row** — that catches the half-written file) + revert
  the item + transient `notify`. (ADR-0003)
- **Cancel is the same transition as failure, different handling.** Same cleanup and
  revert, but **no `notify` and no log line**. Route on `err instanceof
  CancelledError`, never on a message string. (ADR-0023)
- **`deviceFilename` is immutable** — generated once, sanitised at generation,
  matched by exact string. Never re-derived at sync time. (ADR-0006 / ADR-0015)
- **`onWatch` and "synced" are one fact.** Item-level "synced" is
  `all(outputs.onWatch)` — derived, never stored. (ADR-0007)
- **Chapters and groups are columns, not tables.** The Book → Chapter → Episode tree
  is a `groupBy` projection. (ADR-0005)

### Runtime

- **The cache follows a _confirmed_ device operation, never an intended one.**
  (ADR-0001)
- **The probe is a task in the pool**, the item's first. `M` comes from it and lives
  in the transient Job. (ADR-0008)
- **One task = one engine invocation = one child = one output file.** (ADR-0008)
- **`N` is the number of ffmpeg children that may exist at once — one limiter, one
  resource.** No nested limit anywhere. `N = max(1, setting ?? cores - 1)`, user
  override verbatim, no upper clamp. (ADR-0012)
- **A pool slot frees when the task unwinds, not when `abort()` is called.** Freeing
  at `abort()` admits `N + K` live children. (ADR-0023)
- **Transfer is strictly serial, and written forward.** Playback order *is* write
  order; nothing anywhere reverses anything. The renderer sends playback order and the
  Sync Coordinator writes it in that order. Transfer does not go through the Job Queue.
  (ADR-0004, ADR-0044 — **not** ADR-0035, which claimed an inversion and is superseded)
- **The scan is published in the watch's own key** — the directory entry's timestamp,
  ties broken by position — sorted once at the device seam, never in the renderer, and
  `readdir`'s own order is discarded. (ADR-0049)
- **Every device write is `<deviceFilename>.part` → atomic rename.** The rename, not
  the last byte, is the confirmation point. (ADR-0010)
- **The device is polled on demand** — window focus, Rescan, before every sync; refused
  while a transfer runs. No background watcher, no mount events. (ADR-0009, ADR-0038)
- **The scan is discarded.** It never becomes rows; the only durable trace is the
  `onWatch` boolean it corrects. (ADR-0006)
- **`locateMount()` does not detect** — it reads the user-picked `mountPath` setting
  and validates it. (ADR-0016)

### IPC and the renderer

- **`invoke()` returns `Promise<Ack>`. It never returns a result** — including
  `scanDevice`. All state arrives on the event stream. (ADR-0011)
- **The state mirror has exactly one writer**: the event handler. Intent never
  updates the mirror; reality does. (ADR-0011)
- **Three event channels only**: `state:snapshot`, `progress:delta`, `notify`.
- **The preload surface is two verbs** over a fixed channel whitelist. No `fs`, no
  `path`, no `ipcRenderer`, no Node in the renderer.
- **Progress is a count of confirmed files, not a parsed percentage.** (ADR-0008)
- **The renderer never imports from `main/`.**

### Settings, logging, packaging

- **Settings seed, they do not govern.** The three encode settings (`bitrateMedia`,
  `bitrateAudiobook`, `splitEveryMin`) are read **when `Process` is pressed** and then
  *recorded* on the row as what the files were made with — not at import (ADR-0036
  superseded ADR-0012's seed rule; the seed/live split itself stands). Live
  (`concurrency`, `logLevel`, `mountPath`) are read at act time and copied nowhere.
  **Every read is `setting ?? codeDefault`.** (ADR-0012, ADR-0036)
- **The log is the durable trace of what the model deliberately forgets** — four
  sites only (failed child, failed device op, startup reconciliation, `.part` sweep).
  Happy-path transitions are not logged. **The log never crosses IPC.** (ADR-0013)
- **Zero network requests, in any code path.** No updater, no telemetry. (ADR-0014)
- **One binary-path resolver in main** is the only code that knows about
  `app.isPackaged`, `process.resourcesPath`, and `.exe`. Adapters ask it; they never
  construct a path. (ARCHITECTURE §9.2)

---

## 4. When the design is actually wrong

It will happen — most likely the Coros filename cap (ADR-0015).

**Do not quietly deviate, and do not edit an accepted decision.** Existing rows in
`DECISIONS.md §1` are historical records — a decision is superseded, never rewritten.
Take the next free number and, in order:

1. Add a row to **§1** — one line, `Status · Date · Surfaced in`, naming what it
   supersedes or amends.
2. Add its **blast radius** to §3: what a future diff would be quietly reversing. A
   decision with no §3 row is one nobody can review a diff against.
3. Note the supersession in **§2**, saying explicitly which clause of the old decision
   moves and which stands — *"0047 was not edited"* is the house phrasing.
4. Update **`CONTRACTS.md`** if a seam moved, and **`ARCHITECTURE.md`** if the
   reasoning did — **only after the decision lands**, never before and never instead.

Show me the row and the blast radius first. If the reasoning is long enough to need
options weighed and rejected, write that out for me in the session — but what gets
committed is the row, not an essay.

Immutability bounds the damage: a changed `deviceFilename` rule affects **new outputs
only**; existing rows keep the name they were born with.

---

## 5. Repo conventions

- **Stack:** Electron + TypeScript + React (renderer), Node (main), better-sqlite3,
  bundled ffmpeg/ffprobe, **Electron Forge** (not electron-builder — ADR-0014's
  mention of it is stale but is not its decision).
- **Commands:** `npm start`, `npm run package`, `npm run make`, `npm run publish`,
  `npm run lint`, `npm run verify:bin` (checks `resources/bin` is static, carries
  `libmp3lame`, and round-trips a sine to mp3), `npm run test:e2e`.
- **Tests are end-to-end only** — Playwright drives the **packaged** app in `e2e/`.
  There are no unit tests; do not invent a `test` script. `test:e2e` repackages first,
  because a stale bundle silently tests old code; `npx playwright test` skips that when
  only the specs changed. Needs `resources/bin` populated, like everything else.
  `package:e2e` differs from `package` by one env-guarded fuse — Playwright attaches over
  the Node inspector, which the shipped build forbids. Nothing in `src/` knows about tests:
  the native pickers are stubbed inside main by the harness (`e2e/fixtures/app.ts`).
- **Layout:** mirrors ARCHITECTURE §4 — `main/` splits into edge / domain / infrastructure;
  `preload/`; `renderer/`.
- **Comments: one line. Always.** No multi-line blocks, no prose paragraphs above a
  function, in any file. If the reasoning does not fit on one line it is not a comment
  — it belongs in a `DECISIONS.md` row, and the line should point at it
  (`(ADR-0021)`). A comment earns its place by saying what the code cannot: why this
  and not the obvious alternative. Never restate the code, never restate `CONTRACTS.md`.
- **Docs: as short as the point allows.** Every doc, ADR and open-question row — the
  sharp edge, never the recap. Length is earned only by reasoning or a rejected
  option; never by restating a seam `CONTRACTS.md` already owns. §2's "short beats
  thorough" governs what you write down, not just what you say.
- **Git: never commit or push unless I ask.** Finish the work, show me what changed,
  and stop. When I do ask: straight to `main` — no feature branches, no PRs. Small
  commits, one slice each; reference the ADR when a commit implements one
  (`feat(sync): temp-name + atomic rename (ADR-0010)`).
- **`resources/bin/` is gitignored and starts empty.** ffmpeg/ffprobe are platform
  _and_ arch specific and must be **static** builds; a fresh clone cannot spawn until
  they are dropped in by hand. Open item — `DECISIONS.md §4`.

---

## 6. Definition of done for a slice

- It does the one thing it said it would, end to end.
- It violates none of §3.
- Failure path considered — **interruption is normal, not exceptional**. Half the
  design exists for the unplugged-mid-transfer case.
- Anything the model deliberately forgets is logged (ADR-0013).
- No new open question left unrecorded.
