# DECISIONS — the log, the supersessions, the blast radius

**Project:** Coros Sync App
**Status:** Living — a row lands here when a decision does

---

## Purpose

Fifty-five decisions numbered to 0056 — **0042 was never used**, and the gap is left
rather than closed, because the numbers are a citation key. One line each: what was
decided, in what order, what supersedes or renames what, and — the part that matters
most in review — **what breaks if you reverse it.** It is the first read of a session
(CLAUDE.md §1) and the map from a code change back to the decision it might be quietly
undoing (CLAUDE.md §3).

Precedence:

```
docs/DECISIONS.md  >  docs/CONTRACTS.md  >  docs/ARCHITECTURE.md  >  the code
```

**The ADR numbers are the citation key.** 348 comments in `src/` and `e2e/` point at a
number here; a row is what they resolve to. The log is ordered by *dependency*, not by
number, which is why 0048 sits above 0047: it amends what 0047 assumed.

**The full ADR bodies — context, options considered, consequences — were removed on
2026-08-22 and are not part of this repository.** The rows in §1 are the record; the
*rejected* options are not, so a decision that looks arbitrary was weighed against
alternatives that this log does not carry.

The **"Surfaced in"** column still names the retired numbered docs (Doc 1–Doc 9). Those
are accurate historical records of where a decision came up; read them as
`ARCHITECTURE.md`. Dates are 2026.

---

## 1. The log

| # | Decision (one line) | Status | Date | Surfaced in |
|---|---|---|---|---|
| 0001 | Device is the authoritative source of truth; `onWatch` is a reconciled cache, moved only by a *confirmed* op. | Accepted | 07-11 | Doc 1 |
| 0002 | The processing engine is bundled/internal, not a user-supplied external tool. | Accepted | 07-11 | Doc 1 |
| 0003 | Processing runs as spawned children; on failure, clean up outputs + revert the item — no `failed` state. | Accepted | 07-11 | Doc 2 |
| 0004 | Two domain coordinators own lifecycle; the Job Queue is domain-ignorant, processing-only; transfer is serial and outside it. | Accepted — premise inverted by 0035 and **restored by 0044**; decision never moved | 07-12 | Doc 3 |
| 0005 | Two entities (MediaItem → Output); chapters and groups are columns, not tables. | Accepted | 07-12 | Doc 4 |
| 0006 | Device identity is a stored, immutable, human-readable `deviceFilename`, matched by exact string. | Accepted | 07-12 | Doc 4 |
| 0007 | Only items/outputs/settings persist; jobs, sessions, scans are transient; rows follow reality. | Accepted | 07-12 | Doc 4 |
| 0008 | The Job Queue schedules spawns (flat, FIFO, N-limited), not items; the coordinator owns the group. | Accepted | 07-13 | Doc 5 |
| 0009 | Device presence is polled on demand, never watched. | Accepted | 07-13 | Doc 5 |
| 0010 | Every device write is `<name>.part` → atomic rename; the **rename** is the confirmation point. | Accepted | 07-13 | Doc 5 |
| 0011 | IPC is command/ack + event stream; `invoke` returns a receipt, never a result; the mirror has one writer. | Accepted | 07-13 | Doc 5 |
| 0012 | Settings seed, they do not govern; `N = max(1, setting ?? cores−1)`, honoured verbatim, no clamp. | Accepted — **seed rule superseded by 0036**; the live rule stands | 07-13 | Doc 6 |
| 0013 | The log is the durable trace of the failures the model forgets; four sites; it never crosses IPC. | Accepted | 07-13 | Doc 6 |
| 0014 | Distribution is GitHub Releases, ad-hoc signed; no updater; zero network requests in any code path. | Accepted | 07-14 | Doc 7 |
| 0015 | `deviceFilename` sanitisation: one FAT-safe rule, 120-char stem cap, at generation, every host OS. | Accepted | 07-14 | Doc 7 |
| 0016 | The user picks the device folder; `mountPath` is a live setting, validated (not detected) at use. | Accepted | 07-14 | Doc 7 |
| 0017 | The import picker runs in main; `import` carries `{ type, paths? }`, renderer sends `{ type }` only. | Accepted | 07-14 | Walking skeleton |
| 0018 | The discriminator column is named `type`, not `kind` (a rename only). | Accepted | 07-19 | Persistence slice |
| 0019 | `deviceFilename` composition: the exact stem-assembly + disambiguation rule; no cross-item order in the name. | **Proposed** | 07-21 | Processing slice |
| 0020 | Sources are read in place — no copy-in, no `libraryPath`; the managed library holds produced mp3s only. | Accepted | 07-22 | Processing slice |
| 0021 | Lifecycle ownership is per-*column*: Processing creates/deletes Output rows, Sync owns `onWatch`. | Accepted 08-10 | 07-22 | Processing slice |
| 0022 | `deleteItems` is a library-only operation; an orphaned synced file becomes `unmanaged` on the watch. | Accepted 08-10 | 07-22 | IPC surface |
| 0023 | In-flight cancellation is an `AbortSignal` handed to the task; a cancelled task always rejects `CancelledError`. | Accepted 08-10 | 07-30 | Job Queue slice |
| 0024 | Settings are state: they ride `state:snapshot` as **effective** values; code defaults live in main, in one module. | **Proposed** | 08-11 | Settings slice |
| 0025 | A transfer stops **between files**, on a flag, not a signal; the stop is quiet; one session at a time. | **Proposed** | 08-11 | Sync slice |
| 0026 | Seed defaults are 128 / 64 / 10 — supersedes ADR-0012's three numbers and nothing else. | **Proposed** | 08-11 | Settings slice |
| 0027 | Import from a URL via bundled yt-dlp; retires ADR-0014's zero-network invariant. Amended by 0055. | Accepted 08-22 | 08-12 | Wireframe review |
| 0028 | `device` on `state:snapshot` widens to the device's own file order, plus `freeBytes` and `syncing`. | **Proposed** | 08-12 | UI slice |
| 0029 | `deleteFromDevice` names files, not Output rows — an `unmanaged` file has no row. | **Proposed** | 08-12 | UI slice |
| 0030 | `orderIndex` is global within a `type`; group order is `min(orderIndex)`; a `reorder` intent writes it. | **Proposed** | 08-12 | UI slice |
| 0031 | No delete — library or device — runs while a transfer does. Extends ADR-0022's refusal. | **Proposed** | 08-12 | UI slice |
| 0032 | A cancelled child is `SIGKILL`ed and the adapter settles on `close`, never `exit`. | **Proposed** | 08-12 | §4 cleanup |
| 0033 | `revertItems` takes `processed`/`ready` back to `imported` — the cancel path's cleanup, asked for on purpose. | **Proposed** | 08-13 | UI slice |
| 0034 | `eject` is a ninth Device Adapter call, resolves the volume by device number, and is the only one that spawns. | **Proposed** | 08-13 | UI slice |
| 0035 | Playback order is the **reverse** of write order; the session is written backwards. Supersedes 0004's premise and ARCHITECTURE §2 fact #4. | **Superseded by 0044** | 08-13 | UI slice, confirmed on the watch |
| 0036 | Bitrate and split length are read when Process is pressed, then recorded on the row. Supersedes 0012's seed rule. | **Proposed** | 08-13 | UI slice |
| 0037 | Schema migrations are an ordered ladder floored at the current version; creation moves behind the check. Supersedes §4's *detection, not a migration ladder*. | **Proposed** | 08-14 | §4 |
| 0038 | Window focus is what "opens the Device view" means in a permanent-column layout; a scan is refused mid-transfer. Gives ADR-0009's first trigger an implementation. | Accepted | 08-14 | UX/flow review |
| 0039 | Emission belongs to whoever wrote the state: a coordinator emits after writing a column it owns, the Gateway emits only request-scoped replies, a predicate never emits, and `emitChanged()` is rate-limited (leading edge, trailing flush, 50 ms). Supersedes nothing — it names a seam the design never named. | **Proposed** | 08-14 | Architecture review — "who is allowed to call `emitChanged()`?" |
| 0040 | An output carries **two** immutable device names; two live per-type settings decide which one sync writes. Amends 0006's singularity; writes 0037's first ladder step. | **Proposed** | 08-15 | Walking skeleton — an already-split audiobook arrives correctly named |
| 0041 | The `music` item type becomes `media`. Amends 0018's value list, not its decision — the column is still `type`. | **Proposed** | 08-15 | Settling ADR-0027 — a fetched video has no honest home |
| 0043 | A `media` source already mp3 at or under target is stream-copied, not re-encoded; `items.bitrate` is written after the probe. Refines 0036's write. | **Proposed** | 08-15 | "can an item bypass the conversion?" |
| 0044 | Playback order is **write** order; what runs backwards is the *listing*, inverted once at the device seam. Supersedes 0035, restoring 0004's premise and ARCHITECTURE §2 fact #4. | Accepted — **scan clause superseded by 0048, then by 0049**; *playback order is write order* stands, confirmed three times | 08-16 | A book synced to an empty watch played back-to-front |
| 0045 | `Denied` is a fourth device failure kind; `device.connected` becomes `reach`, and a forbidden volume is a state of its own — not an absent one. Amends 0028's shape. | **Proposed** | 08-17 | Rescan could not read a watch the folder picker had just read |
| 0046 | A closed multi-part row states its file count at rest, so `Sync (151)` is explained where it is caused. Column 3 stays the scan. | **Superseded by 0047** (its counter rule survives and widens) | 08-17 | Five tracks staged, and the button read `Sync (151)` |
| 0048 | The scan is published as `readdir` reports it — no inversion at either end. Supersedes 0044's scan clause; its *playback order is write order* stands. | **Superseded by 0049** — its premise, that `readdir` returns write order, was measured false | 08-17 | `01.mp3` and `02.mp3` rendered `02 01.mp3` / `01 02.mp3` |
| 0047 | Staging is a place: `ready` renders in column 3 under a divider, column 2 holds `processed` only, `[Sync]` moves to the column that shows its result, and `unstage` is `stage` backwards. Supersedes 0046, spends 0028's framing, reverses 0033's option A. | **Proposed** — its selection exemption, its *managed rows join the staged list* and its *`reorder-all` has no boundary* clauses are **amended by 0050**; its *one shared tick set*, its *`[Stage]`'s count is the ticked `processed` rows* and its *staged region is pickable* clauses are **amended by 0051, 0052 and 0053** | 08-17 | Five tracks to send, a `Sync (151)` button, and no way out of Ready |
| 0049 | The seam sorts the scan into the watch's own key — `mtimeMs`, ties broken by `ino` — and publishes that; `readdir`'s order is discarded. Supersedes 0048; 0044's *playback order is write order* stands a third time. | **Proposed** — the tie-break's durable form is still open (one test decides) | 08-18 | Library order `01 02 03 05 04`, playing `1 2 3 5 4`, rendering `1 2 3 4 5` |
| 0050 | The ticked list is the session in **both** modes, and column 3 shows the watch *and* the plan in both: `reorder-all` rebuilds exactly what it is given, and the confirm counts what it will not put back. Amends three of 0047's clauses. | Accepted 08-19 — its *ticked* framing is **amended by 0053**; its rebuild/confirm clauses stand | 08-19 | A staged chapter, alone in column 3, becoming all 146 parts when the radio moved |
| 0051 | Each column holds its own tick set — three `useState`s, not one — so a tick made in one column is invisible to another; `⤓` writes column 3's set only. Amends ADR-0047's shared-set clause. | Accepted 08-22 | 08-19 | Ticking one chapter in column 2 to preview staging, and finding column 3 had narrowed to it |
| 0052 | `[Stage]` flips item state **and** unions the ticked output ids into column 3's send list in one press; a ticked `ready` row now counts as `[Stage]`'s work. Amends ADR-0047's count clause; follows 0051. | Accepted 08-22 — its *count in rows* half is **amended by 0054** | 08-19 | One chapter ticked, `[Stage]` pressed, and all 146 parts landed in the staged region |
| 0053 | Column 3 has no checkbox at any depth — `selected`/`onSelect` on `Cell` become optional and their absence is the rule; the send list is edited only where it is built (`[Stage]`, `⇤`), never by a click in the region it renders. Amends ADR-0047's two-way region and ADR-0050's *ticked* framing. | Accepted 08-22 | 08-19 | Clicking a row in the staged region dropped the other 145, then unticking the last one brought them all back |
| 0054 | `⇤` moves below the item row and edits the send list (not `state`) at chapter and part granularity; `Stage (N)` and `Sync (N)` both count parts, off the same array. Amends ADR-0053's round-trip cost and ADR-0047's row-counted `[Stage]`. | Accepted 08-22 | 08-19 | `⇤` reachable only on the book row, and `Stage (1)` for three chapters of a 146-part audiobook |
| 0056 | Settings can fetch a current yt-dlp into `userData/bin/` and point `ytdlpPath` at it: checksum-verified, user-initiated, never on launch. Amends ADR-0014's *no updater* for one bundled tool, ADR-0013's failed-child log site, and ARCHITECTURE §8.4's *one network call site*. | Accepted 08-22 | 08-22 | `ytdlpPath` assumed a user who can find a binary |
| 0055 | The bundled yt-dlp is overridable by a live `ytdlpPath` setting, and the format selector is `bestaudio/best`. Amends ADR-0027's single-resolver clause and ADR-0002's bundled-not-user-supplied clause, for yt-dlp only. | Accepted 08-22 | 08-22 | Rot has no updater to fix it |

---

## 2. Supersessions, renames, and authorised edits

- **ADR-0021 (accepted 08-10) was the first supersession in the set** — it
  replaces the *ownership clause* in ADR-0005's and ADR-0007's Consequences (each ADR's
  decision itself stands untouched; neither was edited). Everything else in 0001–0023 is
  Accepted and current, except 0019, which is still Proposed. The reading rule for
  ownership everywhere is now 0021's: **`items.state` is the Processing Coordinator's;
  `outputs.onWatch` is the Sync Coordinator's; row creation and deletion in both tables
  belong to Processing.** Where 0005 or 0007 say "Sync writes `outputs`", read past it.
- **ADR-0036 supersedes ADR-0012's *seed rule*, not its live rule.** The three keys that were
  seeds — `bitrateMusic`, `bitrateAudiobook`, `splitEveryMin` — are read when Process is pressed
  and then *recorded* on the row as what the files were made with. 0012's live rule, `N`'s
  formula and floor, and `setting ?? codeDefault` at every read are untouched, and 0012 was not
  edited. The seed/live distinction it drew was right; assigning these three to the seed side was
  not. **`items.bitrate` is nullable as of this ADR**, so `SCHEMA_VERSION` is 2.
- **ADR-0040 amends ADR-0006's *singularity*, not its identity rule.** An output now has two
  device names, `deviceFilename` and `deviceFilenamePlain`. Both are generated once, at plan
  time, and neither ever changes — 0006's actual property. What 0040 removes is the assumption
  that a row has *one* such name, which every comparison site had quietly baked in: reconcile,
  `files[].managed` (0028), `deleteFromDevice` (0029) and the `reorder-all` wipe all now match
  **either** name. Sync selects between them from a live setting; it never composes one. **0006
  was not edited**, and ADR-0019 remains the only home for stem assembly — 0040 adds a sibling
  rule beside it rather than replacing it. **`outputs` gains a column, so `SCHEMA_VERSION` is 3**,
  and 0040 writes 0037's first ladder step, including the `app.db` copy that 0037 deferred to it.
- **ADR-0043 refines ADR-0036's *write*, not its decision.** 0036 settled *when the encode
  settings are decided* — at Process, in `runItem`, from the live settings — and that is
  untouched. 0043 moves only the moment the row **records** the bitrate, from the `processing`
  flip to just after the probe, because the probe is what decides whether the target is honoured
  or the source's own bitrate is kept. The column still means what 0036 made it mean: *what these
  mp3s were actually made with*. **0036 was not edited**, and its supersession of 0012's seed rule
  is untouched. The corollary is that a run that fails in the probe now records nothing, where it
  used to record a bitrate for outputs that were never made.
- **ADR-0041 amends ADR-0018's *value list*, not its decision.** The discriminator is still the
  column `type` — 0018 settled that and 0041 does not reopen it. Only the spelling of one value
  moves: `'music'` becomes `'media'`, because the `M = 1` bucket was never really about genre and
  ADR-0027 fills it with lectures and talks. The settings keys `bitrateMusic` and `renameMusic`
  rename with it and, unlike ADR-0031's precedent, are **migrated rather than left to fall back**
  — the ladder exists now. **0018 was not edited**, and neither was any other accepted ADR:
  **read `music` in 0005, 0012, 0017, 0018, 0019, 0030 and 0040 as `media`**, exactly as 0018
  itself asks `kind` to be read as `type`. **`SCHEMA_VERSION` is 4.**
- **ADR-0044 supersedes ADR-0035 outright**, and in doing so puts ADR-0004's premise and
  ARCHITECTURE §2 fact #4 back the way they were first written. 0035 was not wrong about *an* inversion — it
  was wrong about which thing is inverted. "Newest first" belongs to the directory listing, not
  to the player: `readdir` returns the reverse of write order, and the player follows write
  order. So the transfer loop writes forward again, and the scan is reversed once at the device
  seam before it is published. **0035 was not edited** — it is the record of a measurement read
  one seam too far, which is worth keeping. **ARCHITECTURE §2 fact #4 has now been corrected twice**, and
  shows both edits on purpose.
- **ADR-0049 supersedes ADR-0048, and ends the search for a direction in the listing.** 0048's
  premise was that `readdir` returns write order; on macOS 26's fskit `msdos` driver it returns
  **name** order, measured directly — five files written `zz mm aa kk bb` read back `aa bb kk mm
  zz`. So the listing has no device order to publish, invert, or trust, and every earlier reading
  of its "direction" was reading the filenames. What replaces it is not another inversion but a
  different *field*: the watch orders by the directory entry's **timestamp**, with the directory
  position breaking ties inside it — the only rule that fits `01 02 03 05 04` playing while
  `readdir` says `01…05` and the slots say `05 04 01 02 03`. The seam sorts by that and publishes
  it, so column 3 is an observation of the device rather than a computed guess about it. **0048 was
  not edited**, and neither was 0044 — whose *playback order is write order* this confirms a third
  time, with FAT slot reuse present, which also retires 0048's slot-reuse explanation.
  **`SCHEMA_VERSION` stays 4**; the durable form of the tie-break is the one part still open.
- **ADR-0045 amends ADR-0028's *shape*, not its decision.** 0028 settled that the device's own
  file list rides the snapshot, and that `syncing` is published rather than inferred; both stand.
  What 0045 changes is one of its four fields: `connected: boolean` becomes
  `reach: 'ok' | 'unreachable' | 'denied'`, because a boolean cannot hold the case the OS actually
  produces — a volume that is mounted, listed by the picker, and forbidden to `readdir`. **0028
  was not edited**, and 0045 authorises its own post-landing edits to CONTRACTS §4 and §5 and to
  ARCHITECTURE §10.4's empty-state table, the way 0016 and 0017 did. **ADR-0016 does not move**: `locateMount()`
  still validates by `stat` and still does not detect — 0045's option A, which would have made it
  prove readability, is rejected in the ADR for breaking `eject`.
- **ADR-0050 amends ADR-0047's selection clause, not its decision.** 0047 put the staged region in
  column 3 and declared it *is* the session — then exempted `reorder-all`, because a subset of a
  wipe-and-rebuild leaves the watch holding the subset. That is true and is what the mode does; the
  error was inferring the user cannot mean it, so a radio about **order** decided what column 3 said
  was going. The mode branch therefore leaves `sessionOutputIds`, the `onWatch` filter stays
  `append-new`'s alone, and "nothing ticked means everything" keeps the ordinary case identical.
  **0047 was not edited** — its region, divider, shared tick set and `unstage` all stand. Main never
  held the rule: `buildSession` has always written the list it was handed, so this deletes renderer
  code and moves no seam. **`SCHEMA_VERSION` stays 4.** It takes two further clauses with it: with a
  narrowed session, 0047's merged run for `reorder-all` would delete managed files that appear
  nowhere on screen, so **both regions now render in both modes** — the watch above as a fact, the
  session below as a plan, and a row that shows only above is one the rebuild will not put back. The
  cost is a managed row appearing twice in that mode, which is what delete-then-rewrite is.
- **ADR-0051 amends ADR-0047's shared-selection clause, not its regions, counter rule or `unstage`.**
  0047 kept one tick set across all three columns and named the cost — a tick in column 2 changes
  what column 3 sends. In use the cost was worse than named, because the three columns tick three
  different verbs (transcode, stage, send) and each button already had to filter the shared set down
  to its own. 0051 gives each column its own set; `⤓` now writes column 3's alone. **0047 was not
  edited.** No seam, no schema, no IPC change — selection was never in the mirror (ADR-0011).
- **ADR-0052 amends ADR-0047's `[Stage]`-count clause, not staging's item-level scope.** `stage` still
  flips `items.state` per item (ADR-0021 untouched); what changes is that the renderer also unions the
  ticked *output* ids into column 3's send list in the same press, because that pick had nowhere to
  land before and a chapter tick was silently staging (and sending) the whole book. `[Stage]` now
  counts every ticked row, `ready` included — the one clause of 0047 that inverts. **0047 was not
  edited.** No seam, no schema change.
- **ADR-0053 amends ADR-0047's two-way region and ADR-0050's *ticked* framing.** Both ADRs made the
  staged region *be* the session; 0053 keeps that but removes the checkbox that made the region also
  *write* the session it was rendering — a feedback loop where clicking a row moved the thing being
  clicked. Column 3 becomes read-only (`⇤` and the delete icon only); the send list is built in column
  2 by `[Stage]` and trimmed by `⇤`, never by a click in column 3. **Neither 0047 nor 0050 was
  edited** — 0050's rebuild-and-confirm rules stand; only the word "ticked" no longer describes what
  builds the list. No seam, no schema change.
- **ADR-0054 amends ADR-0053's stated cost and ADR-0047's row-counted `[Stage]`.** 0053 accepted that
  narrowing a staged book would cost a round trip (`⇤` the item, re-tick in column 2); 0054 removes
  that cost by giving `⇤` a chapter- and part-level form that edits the send list directly. It also
  moves `[Stage]`'s count from rows to parts, matching ADR-0046's file-counting rule for `[Sync]`, so
  the two buttons can no longer disagree on what a number means. **Neither 0053 nor 0047 was edited.**
  No seam, no new intent, no schema change — `unstage` is the existing intent, called with whatever
  the last-part rule computes.
- **ADR-0026 supersedes ADR-0012's *numbers*, not its decision.** 0012's Decision
  listed `bitrateMusic` 192 / `bitrateAudiobook` 64 / `splitEveryMin` 15 as an
  illustration of what a seed setting is; the code always ran 128 / 64 / 5 and
  CONTRACTS recorded the code. 0026 settles it at **128 / 64 / 10**, with reasons.
  Everything else in 0012 — the seed/live split, N's formula, the verbatim override,
  the floor of 1, the fixed `libraryPath` — is untouched and current. 0012 was **not**
  edited.
- **ADR-0019 is the one open decision.** Its confirmation point — that the watch plays in
  upload/directory order rather than filename sort — is an assumption **ADR-0004 already
  rests on**, not one 0019 introduced, so 0019 cannot discharge it. Code is being written
  against the composition rule regardless; the choice is to accept it and carry the
  assumption as an open question (§4), or spike playback order first.
- **ADR-0023 extends ADR-0004 and ADR-0008 rather than superseding them.** The queue
  gains a cancellation *token* it hands to the task; it gains no domain knowledge, so
  0004's domain-ignorance clause is intact and 0008's group-key-as-cancellation-unit is
  unchanged. Read the two together.
- **ADR-0020 supersedes nothing** — it is the first ADR to *surface* a decision the
  design had only ever asserted. The copy-in was asserted by the early docs with no ADR
  behind it; 0020 weighed it and reversed it. The numbered docs were edited under its
  authority, which is a doc correction, **not** an edit to an accepted ADR.
- **The numbered design docs (Doc 1–Doc 9) were retired on 2026-08-22** and merged into
  `ARCHITECTURE.md`; the ADR bodies were removed at the same time (see *Purpose*). The
  "Surfaced in" column and the supersession notes still name them — those are accurate
  historical records of where a decision came up, and were not rewritten. Doc 2 had
  already been retired earlier, into Doc 3 §0.
- **ADR-0018 (`type` vs `kind`)** is a lexical pointer, not a supersession: ADRs
  0005 / 0012 / 0017 still read `kind`; take it as `type` everywhere else, and do
  **not** edit those three (CLAUDE.md §4 — accepted ADRs are historical records).
- **ADR-0012 still says `libraryPath`** where it means *the library's location*. That
  column is gone (0020), but 0012's actual decision — the location is fixed at
  `userData/library`, not a setting — is untouched and current. Same treatment as the
  `kind`/`type` rename above: read past the word, do **not** edit the ADR.
- **ADR-0017 and ADR-0016** each authorised their own *post-landing* edits to
  CONTRACTS / the docs (the `paths?` payload; the mount-pick seam). **ADR-0019**, if
  accepted, does the same for the composition detail in CONTRACTS §5.
- **ADR-0015's 120-char cap** was the design's self-nominated first-to-fall (a
  "conservative guess"). Spike A confirmed 120 holds on a real device, so it stands —
  but it remains the revisit point if a stricter model appears.
- **ADR-0014 names electron-builder**; the toolchain is Electron Forge (Spike B). That
  mention is not its decision, so the ADR was left untouched; the live signing
  question is an open item in §4 below, not an ADR change.
- **ADR-0027 supersedes ADR-0014's *consequence*, not its decision.** GitHub Releases,
  ad-hoc signed, **no updater** all stand, and so does every argument that rests on them.
  One clause moves: *"zero network requests, in any code path"* becomes **every existing path
  still works offline; one new path does not**. The offline guarantee weakens from total to
  partial, which is a smaller claim, not a retracted one — and Doc 1's non-goal *"no cloud,
  streaming, accounts, or networking of any kind"* is amended with it. **0014 was not
  edited**; ARCHITECTURE §8.4 is, because 0014's invariant was the whole of its argument.
- **ADR-0027 amends ADR-0020's *no-copy-in* clause, not its *no-`libraryPath`* clause.** A
  URL has no path to read in place, so the fetched file is the app's second owned blob, in
  `userData/sources/<downloadId>/`, and `deleteItems` owns it. The managed library still holds
  produced mp3s only, its location is still fixed rather than a setting, and a file-imported
  item still has exactly one blob and is read where it lies. Provenance is **derived** — is
  `sourcePath` under `sourcesRoot()` — so there is no column and **`SCHEMA_VERSION` stays 4**.
  **0020 was not edited**, and its recorded cost (an `imported` item is not self-contained)
  now cuts the other way for this one class: a downloaded source cannot be unplugged.
- **ADR-0027 does not touch ADR-0017.** 0017's blast radius polices *renderer-supplied
  paths*, and a URL is not one: it names a remote resource, carries no filesystem reach, is
  scheme-checked before it reaches a child, and is passed as one argv element to a process
  spawned without a shell. The picker still runs in main and paths still never cross IPC.
- **ADR-0056 amends ADR-0014's *no-updater* clause for a bundled tool, not for the app.** The
  app still never checks its own version — no release-check, no `electron-updater`, no
  restart-to-apply, on launch or ever — and that is the clause 0014 actually defends. What 0056
  adds is a **press** that replaces a *tool the app spawns*, leaving the bundle untouched. Its
  only output is a value for `ytdlpPath`, so it adds no seam: it automates the setting ADR-0055
  already built, and `ytdlpPath() ?? resolveYtdlp()` remains the whole of "which yt-dlp".
  **0014 was not edited**, and neither was 0055. Two smaller amendments ride with it:
  ARCHITECTURE §8.4 goes from one network call site to two, and **ADR-0013's *failed child* log
  site widens to *failed external operation*** — a failed fetch forgets its reason exactly as a
  failed child does. It is still four sites, not five.
- **ADR-0055 amends ADR-0002's *bundled-not-user-supplied* clause for yt-dlp only.** ffmpeg
  and ffprobe stay bundled-only and stay the answer to 0002's question, because they do not
  rot — the format they encode is frozen and the sites yt-dlp parses are not. 0002's scope
  boundary (the app owns its engine; it is not a front-end for whatever is on `PATH`) stands:
  `ytdlpPath` is a named override of one binary, not a discovery mechanism, and its absence
  is the normal case. **0002 was not edited.**

---

## 3. Blast-radius table — what reverses if you undo it

Read this the way CLAUDE.md §3 is meant to be read: if a diff does the thing in the
right column, it is quietly reversing the ADR on the left. Name the ADR and make the
change deliberate, or don't make it.

| ADR | Protects | Blast radius if reversed |
|---|---|---|
| 0001 | Cache follows a *confirmed* device op, never intent. | A failed/interrupted op marks a file present or absent falsely → the lying-record failure the whole device model exists to prevent. |
| 0003 | No `failed` state; failure = cleanup + revert + notify. | A `failed` enum value; items stranded in a dead error state the lifecycle must carry forever. |
| 0004 | edge→domain→infra; two lifecycle writers; a domain-ignorant queue; serial transfer *outside* the pool. | Infra calls a coordinator; a third state writer; the queue learns the word `imported`; transfer routed through the pool at `concurrency:1`. |
| 0005 | Two entities; chapters/groups are columns. | A `Chapter` / `Collection` / `Group` table; recursive `parentId`; heterogeneous half-null rows. |
| 0006 | `deviceFilename` immutable, generated once, exact-string match. | A name re-derived from `title` at sync time → the app can't find its own file → wrong delete / re-upload. |
| 0007 | Three tables; rows follow reality; `M` is transient. | A `jobs` / `sessions` / `scans` table; an Output row written before exit 0; `M` or `synced` persisted. |
| 0008 | One flat N-limiter on spawns; one task = one child = one output; probe is a pool task. | A nested limit (real ceiling `N×K`); a segmenting child writing many files; `M` probed outside the pool; a percentage parsed for progress. |
| 0009 | Poll on demand. | A background USB/mount watcher; a timer poll; a "device appeared while you weren't looking" state to manage. |
| 0010 | `.part` → atomic rename is the confirmation point. | Writing straight to the final name → a truncated file masquerades as synced (0001 through the back door). |
| 0011 | `invoke` returns `Ack`, never a value; one mirror writer; three channels; two-verb preload. | `const x = await invoke()` used for its value; a fourth event channel; `fs`/`path`/`ipcRenderer` on the preload surface; renderer optimistic writes. |
| 0012 | Seed vs live; `N` floor 1, no clamp; every read `?? codeDefault`. | A second concurrency knob; a clamped `N`; a settings read with no default. *(The seed half — "a seed value re-read after import" — is what 0036 deliberately reversed.)* |
| 0036 | *(Proposed)* the encode settings are read at Process and recorded on the row. | Reading them at import → changing a setting then pressing Process silently uses the old value, and the only escape is deleting the row. Not recording them → nothing can answer "what was this made with" once the setting moves, which is the question a mixed library asks. Moving bitrate but not `splitEveryMin` → one `planTasks` line reading two values decided in different eras. |
| 0013 | Log only where the model forgets (4 sites); never crosses IPC. | Happy-path transitions logged into noise; a `logs:content` event channel; log text sent to the renderer. |
| 0014 | *(Zero-network clause retired by 0027)* GitHub Releases, ad-hoc signed, **no updater**. | `electron-updater` or a release-check on launch → the app grows the update channel 0014 refused, and an ad-hoc signature is the wrong thing to trust code arriving down it. `fetch` / `https` / a socket **in main outside the Download Adapter** → the one network path becomes many, and ARCHITECTURE §8.4's chapter is written for exactly one. Anything at all in the **renderer** → `connect-src 'none'` and the two-verb sandbox are what survived 0027, and they are now the whole of the security argument. |
| 0015 | One FAT-safe sanitise, at generation, host-independent. | Host-OS sanitisation → a key legal on macOS, rejected by FAT at write time, already persisted as an immutable key. |
| 0016 | `locateMount` validates a picked path; it does not detect. | Volume-label / structural detection → a per-platform enumeration layer + a hardware assumption per model. |
| 0017 | Picker in main; paths never cross IPC as a value. | `webUtils.getPathForFile` (or any third verb) added to the two-verb sandbox so the renderer can supply paths. |
| 0019 | *(Proposed)* the name carries intra-item order only; cross-item order is the upload sequence's. | A global index in the name → breaks immutability (0006) the first time an item is imported ahead of an un-synced one. |
| 0020 | One app-owned blob per item (its outputs); the source is a path, read in place. | A `libraryPath` column or a `copySourceIn` call → 2× storage on the largest artifacts, a second blob for item deletion to leak, and main back in the byte path at import. |
| 0021 | Ownership is per-column: Processing creates/deletes Output rows, Sync moves `onWatch`. | Either coordinator writing the other's column → two writers for one fact, which is the thing 0004 bought with the split. A generic `updateOutput(id, fields)` on the Repository is the specific shape to refuse. |
| 0022 | `deleteItems` is library-only; no device call, no `onWatch` read. | A Processing intent driving a device op → the two coordinators compose for the first time, and a partial-delete story the design has nothing else for. |
| 0023 | Cancel reaches the running child via a signal; the slot frees on unwind, not on `abort()`. | Freeing the slot at `abort()` → `N + K` live children while the killed ones die (0008's nested limit by another route). Or an untyped cancel rejection → the coordinator cannot tell cancel from a failed child, and runs 0003's notify + log on a cancel the user asked for. |
| 0024 | *(Proposed)* settings are state, carried as effective values on the one channel that already carries state. | A fourth event channel, or `getSettings` returning its values in the Ack → `invoke()` stops being `Promise<Ack>` and 0011's structural discipline decays into a convention with an exception. Or raw rows in the snapshot → a second copy of every code default, in the renderer, free to drift (it already did once: `bitrateMusic` 128 vs 0012's 192). |
| 0025 | *(Proposed)* the transfer stops between files, quietly, and only one session runs at a time. | Stopping mid-file → a `.part` the user's own "stop" created, i.e. cancel made the device dirtier than doing nothing. A `notify` on stop → 0023's rule (the user's own action is not narrated back) broken for one case. Concurrent sessions → two upload orders interleaved into one playback order. |

| 0033 | *(Proposed)* one intent takes a processed item back to `imported`, by running the cancel path's cleanup on purpose. | An unstage that only moves `state` → the title is editable while the mp3s keep the tags and names they were born with, so the library and the watch disagree in the one field the user is looking at. A partial revert (per output) → the Output becomes a unit of library intent, which 0022 spent an ADR refusing. Re-reading the seeds on the way back → 0012's "seeds are never retroactive" quietly stops being true. |

| 0044 | *(supersedes 0035)* the session is written forward. **Its scan-reversal half is superseded by 0048.** | Reversing the write loop as 0035 did → every book plays backwards, which is the bug this ADR exists for. Reversing the scan in `DeviceColumn` instead → a device fact in the renderer, which 0035's own option A was rejected for. |
| 0048 | *(**superseded by 0049**)* the listing is published as `readdir` reports it. | Reversing it again at either end → column 3 disagrees with the watch, which is the bug: `01.mp3`/`02.mp3` rendered swapped while playback was correct. Sorting the listing by `deviceFilename` → a tidy order the player does not use, ruled out on 0044's own evidence. Numbering the rows from `orderIndex` instead of listed position → the numbers contradict the row order on screen, and an `unmanaged` file cannot be numbered at all. Assuming the listing *has* a fixed direction → the premise that produced three renames and three reversals in five days; FAT slot reuse means it does not. |
| 0049 | *(Proposed, supersedes 0048)* the seam sorts the scan by the watch's own key — timestamp, ties broken by directory position — and `readdir`'s order is discarded. | Ordering column 3 by the listing again → the column is right only while filenames ascend in write order, which is the bug: `05` written before `04` rendered after it. Ordering it by the library instead → correct until the library is reordered after a sync, i.e. wrong in exactly the case that surfaced this. Recording the order app-side as the *primary* key → a claim where an observation was available, and a sideloaded file — which has a timestamp but no row — cannot be placed at all. Dropping the tie-break → FAT stores mtime to two seconds, so a serial transfer of small files ties routinely and the order inside a batch becomes arbitrary. Naming the files so the sort matches → third rejection of the same option; the player ignores names, and it re-derives an immutable field (0006). |
| 0034 | *(Proposed)* the adapter finds the volume itself and asks the OS to unmount it; `onWatch` is untouched. | Ejecting `mountPath` directly → `diskutil` refuses a subfolder, so the button works only for users who happened to pick the volume root. Clearing `onWatch` on eject → "synced" would mean "plugged in", and the next scan would re-transfer a watch that was already full. A "safe to unplug" button with no OS call → a safety claim the app cannot make. |
| 0045 | *(Proposed)* a forbidden volume is `reach: 'denied'`, classified where the read happens, published not toasted. | Folding `Denied` back into `IoError` or `DeviceGone` → column 3 asks whether a mounted watch is plugged in, and hides the one control that restores access; 0001's failure-by-inference, arrived at through the error path instead of the cache. Raising it from `locateMount` → `eject` dies on a volume it could still unmount, since `diskutil` needs no read permission. A `notify` instead of a state value → 0038's focus-rescan toasts on every window focus, and dismissing it hides a condition that has not gone away. Letting a `Denied` from `copy` set `reach` → a `chmod 500` watch reports itself unreadable when it lists fine, which `07-a-full-watch-is-still-plugged-in.spec.ts` is the guard against. Publishing `freeBytes` from `statfs` while denied → a space figure beside an empty list, on a device we admit we cannot read. |

| 0047 | *(Proposed)* staging is a place — `ready` renders at the watch, column 2 holds one state, `unstage` is the way back. | Rendering `ready` beside `processed` again → column 2 needs grey, a playback number and a tick to separate two populations, and the numbering claims an order `append-new` does not deliver (which is where `Sync (151)` came from). Making column 3 the order *editor* rather than the preview → order becomes a property of outputs, which 0022 refused, and the discarded scan (0006) starts looking authoritative. Letting `unstage` delete anything → it collapses into `revertItems`, and 0033's expensive path becomes the only path again. Writing `orderIndex` on unstage → a re-staged item loses its place, so taking a book off the list silently reorders everything else. Rendering the scan below the line during a `reorder-all` → the column empties itself as the wipe confirms each delete, instead of greying in place. |
| 0050 | *(Ticked framing amended by 0053)* the session renders in both modes; `reorder-all` rebuilds exactly what it is given; the confirm counts what a rebuild will not put back. | Filtering managed rows out of the upper region again → a narrowed rebuild deletes files that are on screen nowhere, and the confirm's count is the only witness. Exempting one mode from the selection again → a control about *order* decides *contents*, and column 3 contradicts the plan that built it, which is the bug. Narrowing the plan while wiping only what it rewrites → un-ticked managed files keep their old slots in a directory rebuilt around them, so the order the mode exists to impose is not imposed. Dropping the count from the confirm → the sole guard on a gesture that can empty the watch reads the same whether it removes nothing or 146 files. Making `ready` per output so the rule is unnecessary → an Output becomes a unit of library intent, which 0022 spent an ADR refusing. |
| 0051 | Each column ticks for itself; `⤓` writes column 3's set only. | One shared tick set again → a pick in column 2 silently narrows or widens what column 3 sends, the exact defect this ADR closes. A provenance field (`{id, column}`) instead of three sets → every reader has to filter by column anyway, at the cost of a schema-shaped selection. |
| 0052 | `[Stage]` unions ticked output ids into the send list in the same press that flips `state`. | Flipping `state` without carrying the pick → a chapter tick stages (and later sends) the whole book, because the send list has nothing narrower to fall back to (ADR-0050's "nothing ticked means everything"). Replacing the send list instead of unioning → a second `[Stage]` erases the first, so a multi-chapter send from column 2 becomes impossible. |
| 0053 | Column 3 has no checkbox at any depth; the send list is edited only in column 2 (`[Stage]`) and by `⇤`. | A checkbox back in the region, even disabled → a control the region cannot survive touching, or a lie if it cannot be checked. Decoupling the region from the session instead of removing the box → re-splits region and session, which 0047 spent an ADR unifying, and leaves two places to pick the same parts. |
| 0054 | `⇤` edits the send list at chapter/part granularity; `[Stage]` and `[Sync]` both count parts. | A per-part `⇤` that unstages the whole item → a control on one part that destroys 145 siblings, the shared-set surprise 0051 removed, wearing an icon. Checkboxes back in column 3 for removal only → the exact feedback loop 0053 closed, however the boxes are named. Leaving `[Stage]` counting rows → two adjacent buttons disagreeing on what their number means, with `Sync (151)` the number that mattered. |
| 0043 | *(Proposed)* an already-mp3 `media` source is copied, and the row records the bitrate its files actually have. | Re-encoding it anyway → a generation of loss on every already-correct mp3, in the one direction the user cannot undo. Copying on a task that carries a cut → parts land on frame boundaries, drifting from the times `planAudiobook` asserts. Recording the target rather than the source's bitrate → the row quotes a number no file on disk matches, which is the mixed-library question 0036 kept the column to answer. Writing the bitrate at the `processing` flip again → the column holds an *intent* mid-run and a *fact* afterwards, decided by how far the run has got. |
| 0039 | *(Proposed)* the coordinator that wrote the column emits; the Gateway emits only request-scoped replies; `emitChanged()` is leading-edge + trailing-flush at 50 ms. | The Gateway sending a snapshot on a coordinator's behalf again → the edge reports the domain's work for it, which is ADR-0004's arrow pointing backwards; it is exactly what the `import` path had accidentally become. A predicate emitting → a refused pre-flight publishes a rebuild when no row changed. Debounce with no leading edge → every single click takes 50 ms to appear, to save a rebuild that was never the problem. Dropping the **trailing** flush → intermediate snapshots are safe to drop only because the *last* one is a complete self-healing restatement (ADR-0011); without it a burst can end on a frame that is never corrected. Coalescing `progress:delta` too → it is three numbers, not a rebuild, and it is the one thing the per-file counters render. |
| 0040 | *(Proposed)* two immutable names per output; sync selects one from a live per-type setting and never composes. | Re-deriving the name at sync instead → the join key moves under the row, and every file already on an unplugged watch is orphaned with nothing to notice it. Matching only `deviceFilename` at any one of the four comparison sites → a file written under the other name reads as `unmanaged`, so `append-new` re-sends it and the wipe leaves it behind. Deciding it at import instead → the toggle cannot reach a library that is already processed, which is the entire cost it exists to avoid. |
| 0027 | The download produces a *source*, not an output: it lands `imported`, and the normal pipeline makes every file the watch sees. | yt-dlp handed `--extract-audio` / `--audio-format mp3`, or the item inserted `processed` → the mp3 bypasses `bitrateMedia`, bypasses title/author rewriting, has no `deviceFilename`, and `processed` stops meaning *this app's Engine Adapter made these outputs* (0027's option B, refuted at the time and cheaper-looking every time it is met again). A `downloading` item state → a row exists before its bytes, the one thing 0007 forbids; the transient session carries the progress instead. The download submitted to `pool` → a second resource on 0012's one limiter, so `N` stops being a count of ffmpeg children. Cleanup by file rather than by directory → yt-dlp's `.part`/`.ytdl` fragment has no row and survives forever, which is 0003's trap in a second blob. |
| 0056 | The fetch is user-initiated, verified, and lands outside the bundle. | A launch-time or background check → that IS 0014's updater, and §8.4's *"a URL the user typed, a button the user pressed"* collapses into *"the app phones home"*; the offline guarantee stops being partial and starts being conditional. Writing into `resources/bin` → the macOS ad-hoc `codesign --deep` signature is invalidated and Gatekeeper refuses to launch the app at all, which is a worse failure than the stale binary it fixes. Skipping the `SHA2-256SUMS` check, or doing it after `chmod +x` → the app downloads an executable over the network and spawns it, which is the single step separating this from every other fetch. Any *"which yt-dlp"* branch beyond `ytdlpPath() ?? resolveYtdlp()` → the updater stops being an automated way to write one setting and becomes a parallel path with its own precedence rules. |
| 0055 | The bundled yt-dlp is a default, not the only source. | Hard-wiring `resolveYtdlp()` and dropping `ytdlpPath` → a broken extractor is unfixable until a release, which is the cost 0027 was least able to absorb and the reason it sat deferred; and the e2e suite loses its only way to stub a download without `src/` learning that tests exist. Widening it to a `PATH` search or an auto-detect → 0002's scope boundary really does fall, and `locateMount()`'s rule (read the setting, validate it, never detect) stops being the house pattern. Reading it anywhere but at act time → 0012's live/seed split, with the stalest possible value. |

*(0002 and 0018 back no runtime invariant — 0002 is a scope boundary, 0018 a rename — so they carry no blast-radius row.)*

*(0020's cost is recorded honestly in its own Consequences: `imported` is no longer
self-contained. Import from removable media, eject, then Process, and those items fail
and revert. That is the accepted trade, not an oversight.)*

---

## 4. Open questions

| Question | Status | Where |
|---|---|---|
| Job Queue concurrency `N` | **Closed** — `max(1, setting ?? cores−1)`, verbatim, floor 1. | ADR-0012 |
| `deviceFilename` charset / length | **Closed** — FAT-safe strip, 120-char stem cap. | ADR-0015 |
| `deviceFilename` composition (assembly + disambiguation) | **Proposed** — pins the exact rule; 3 forks + 1 confirmation still open. | ADR-0019 |
| Device plays in write/directory order (not filename sort) | **Open — procedure written 08-11, not yet run.** Three phases: clean write, write *after a delete* (FAT reuses freed directory entries, which is what would break `append-new`), and a power cycle. ADR-0019 cannot leave Proposed until it runs. **The procedure, since the spike file is gone:** use the app's exact write pattern — `cp X.mp3 <mount>/X.mp3.part && mv <mount>/X.mp3.part <mount>/X.mp3` — because a direct create and a create-then-rename need not land in the same FAT slot, so testing the wrong one tests nothing. Prep three ~30s mp3s that *announce themselves in the audio* (the screen is small and may show tags, so identify by ear), each with its ID3 title set to its own filename stem, which is what the app does. **Phase 2:** delete `A.mp3` from a watch holding `C A B`, write `D.mp3`, play. Heard `C B D` → append survives deletion and `append-new` is sound. Heard `C D B` → **`D` took `A`'s slot**, `append-new` cannot guarantee order after any deletion, and `reorder-all` becomes the only correct sync once a file has ever been removed — a UI consequence, not an ADR change, but it needs recording. **Phase 3:** power-cycle and replay; if the order changes, the device re-indexes on boot, nothing about write order is durable, and the design has to stop promising ordered playback and say so in the UI. Record the result either way — a spike whose result is not written down has to be run again. **Phase 1 was read wrong on 08-13 and re-read on 08-16 — ADR-0044 supersedes ADR-0035.** The listing runs newest-first; the **player follows write order**, so a book written `p1 … pN` plays `p1 … pN` and a new batch plays *after* what is already there. What 0035 measured was `readdir`, which returns the reverse of write order — the one thing this row had listed as still unknown, now closed. A filename sort is ruled out on evidence: the failing book's names already ascended by chapter and part, and the player ignored them. **Phases 2 and 3 are still open and the question is sharper**: whether the player orders by write *time* or by directory *position*. On an empty watch those are the same answer, which is why the 08-16 test cannot separate them, and only "write after a delete" can — if it is position, FAT reusing a freed slot drops a new file into the middle of the list, which is the one failure no rename can fix. **08-17 and 08-18 made this a production question before the spike ran, and then split it in two.** 08-17 read `readdir` as returning write order on a watch with history; 08-18 measured the driver itself — five files written `zz mm aa kk bb` on the same volume read back `aa bb kk mm zz`. **macOS 26's fskit `msdos` returns the directory sorted by name**, so the listing never carried an order at all and all three earlier readings of its "direction" were reading the filenames. That half is closed by measurement rather than by spike. What the *watch* orders by was measured in the same sitting and is the timestamp, ties broken by directory position — the only rule fitting `01 02 03 05 04` playing while the slots say `05 04 01 02 03`; tags are ruled out by absence (no `TRCK` on any file). ADR-0049 sorts by that. **What the spike still owes is the player's half** — 08-18 is the third confirmation of write order and the first with slot reuse present (`04` and `05` landed on freed slots below `01`'s and still played in write order), which leaves phase 3's power cycle and a longer-history case. ADR-0019 still cannot leave Proposed without them. | Spike C, ADR-0004, ADR-0019, ADR-0044, ADR-0049 |
| Is the watch's key mtime or creation time? | **Open — surfaced 08-18, and one test answers it.** They are identical on every file the app has written (copy then rename sets both), so nothing so far separates them. `touch` a file already on the watch to a newer time, power-cycle, and see whether it moves to last. **If mtime**: the transfer can stamp ascending mtimes after each rename, ties become impossible, column 3 sorts on `mtimeMs` alone, and playback order stops depending on FAT slot allocation — the phase-2 hazard closed rather than documented. **If creation time**: no portable call sets it, so the tie-break must become a recorded one (`outputs.watchIndex`, `SCHEMA_VERSION` 5). Until then the seam ties on `ino`, which is correct on macOS fskit and derived differently elsewhere. | ADR-0049, Spike C |
| Should `deleteFromDevice` widen to accept **unmanaged** filenames? | **Open — raised 08-10 by ADR-0022.** Under 0022 the app can manufacture an orphan on the watch and then refuse to remove it. Widening makes 0022's option C whole, but reverses ARCHITECTURE §6.3's recorded narrowing and re-opens whether the app may delete files it did not write (sideloaded music). | ADR-0022, ARCHITECTURE §6.3 |
| **Is there a cancel for an in-flight *sync* session?** | **Closed 08-11 — ADR-0025** (Proposed). A flag read between files; the current file finishes; the stop is quiet; one session at a time. No `.part` sweep is needed, because stopping *after* a rename never creates one. | ADR-0025 |
| **How do settings reach the renderer?** | **Closed 08-11 — ADR-0024** (Proposed). CONTRACTS listed `getSettings` with the payload `{ … }`; it had no reachable shape, since a query cannot return a result (ADR-0011) and a fourth channel is forbidden (ADR-0013). Settings ride `state:snapshot` as effective values. | ADR-0024 |
| ~~**Schema drift is undetected**~~ | **Closed 08-11 — built, no ADR. Superseded 08-14 by ADR-0037** (Proposed). The stamp, the guard's shape and the `settings` exemption all survive; what changed is what happens on a mismatch. `verifySchema()` is now `openSchema()`: it creates a fresh database, walks an ordered `MIGRATIONS` ladder, or refuses — one transaction, `foreign_keys` off with a `foreign_key_check` before the commit, since a step that rebuilds `items` under FKs on cascade-deletes every output row. **The ladder is empty and floored at v2**, so nothing user-visible has changed yet; a v1 database is still refused. The load-bearing part is that creation moved *behind* the check — a fresh database and a pre-stamp one both read `user_version = 0`, and only the `IF NOT EXISTS` no-op had been keeping them apart. **The next column change owes a step in the same commit.** | ADR-0037, ADR-0007, ARCHITECTURE §6.4 |
| *(original wording, for the record)* **`CREATE TABLE IF NOT EXISTS` conceals drift** — it is a no-op against an existing table, so a column change in code never reaches an existing DB and the mismatch surfaces at the first *write*, dressed as a domain failure (ADR-0003 renders it as cleanup + revert + `notify`, reading as a coordinator bug). | **Open — deferred 08-11.** Answer chosen, unbuilt: `PRAGMA user_version` stamped by code and verified at open — **detection, not a migration ladder**. Two traps: `db.ts` is side-effectful at import, so the guard must be a function main calls (`showErrorBox` + `quit`), not a module-scope `throw`; and `settings` stays exempt (ADR-0012). Interim posture: when the dev DB drifts, delete it — it is throwaway and zero-row. | ADR-0007, ADR-0012, ARCHITECTURE §6.4 |
| **Import from URL** | **Closed 08-22 — ADR-0027** (Accepted), amended by **ADR-0055**. Built as drafted: yt-dlp fetches `bestaudio/best`, the file becomes `sourcePath` under `userData/sources/<downloadId>/`, the item lands `imported`, and the existing pipeline does the rest. Both blockers were paid rather than dodged — ARCHITECTURE §8.4 is now the security chapter it owed, and the rot cost is answered by 0055's `ytdlpPath` override rather than by an updater (option D became the *fallback inside* option A, not a replacement for it). | ADR-0027, ADR-0055, ADR-0014, ADR-0020, ARCHITECTURE §8.4 |
| **yt-dlp version pinning and refresh cadence** | **Open — surfaced 08-22 by ADR-0055, and demonstrated the same day.** The first pin (2026.07.04) was already dead on arrival: YouTube 403'd every format, and 2026.08.19 fixed it with no change to this app. **Seven weeks of rot was enough**, which sets the scale — a pin is stale in about a month, and a release cadence slower than that ships a broken feature. `resources/ytdlp-version.txt` pins it and CI fetches that tag, mirroring ffmpeg; unlike ffmpeg, the right pin is always *the newest one*. This is the cost ADR-0027 said it was least able to absorb; `ytdlpPath` (ADR-0055) is what stops it being fatal, and **ADR-0056 is what stops it needing a technical user** — the pin is now only what a fresh install starts from. | ADR-0055, ADR-0027, ADR-0014, ARCHITECTURE §9 |
| **YouTube extraction is deprecated without a JS runtime** | **Open — surfaced 08-22 debugging the 403.** yt-dlp warns that extraction without deno/node/quickjs/bun is deprecated and "some formats may be missing"; it currently still succeeds via the visionos player, so this is a warning and not yet a failure. We ship no JS runtime and cannot cheaply become one — Electron's own Node is sealed behind the `RunAsNode: false` fuse, deliberately (ARCHITECTURE §9.3), and unsealing it to feed yt-dlp would trade a security fuse for an extractor. If it becomes fatal the options are: ship a runtime (a fourth binary), pass `--js-runtimes` pointing at one the user already has (a second `ytdlpPath`-shaped setting), or let `ytdlpPath` carry it since a user-installed yt-dlp usually sits beside a user-installed runtime. | ADR-0055, ADR-0027, ADR-0014 |
| **A playlist URL imports one entry** | **Open — surfaced 08-22 building the import.** `--no-playlist` is passed, so a link that names a playlist yields its first entry and nothing says so. Expanding one is a decision, not a flag: N items from one paste, one `groupId`, an unbounded batch behind a single confirm, and a progress count that cannot be known until the extractor has answered. | ADR-0027, ADR-0030 |
| **What each audiobook mp3's tags should read.** `author` stopped being user-editable 08-12 (it feeds a tag the app composes, not a field a user fills in) with the intent of carrying chapter/episode. **It cannot, as stated:** `items.author` is *per item* and an audiobook fans out to N outputs with different chapters, so one row cannot hold per-chapter text. What can is the **per-file tag pair already on `TranscodeTask`** (`title`, `author`) — one task, one child, one file, so composition per output is free and needs no schema change. So the question is a tag-composition rule, not a repurposed column. | **Closed 08-13 — built, no ADR.** `composeTags(item, title, spec, deviceFilename)` on the coordinator. An audiobook gets **`title` = the book, `artist` = `CC PP`** (`03 02` — chapter and episode each **two digits as a floor, widening only when the number needs it**, one space, on *every* output including unsplit chapters, which read `01`). Two digits sort correctly only up to 99; a 100+ book mixes widths and sorts wrong as text, which is acceptable because the tag is display, not ordering — playback order is the upload order (ADR-0004), never a tag. Music is unchanged: `title` = the filename stem, `artist` = `item.author`. ffmpeg's `-metadata` does the writing, from the pair already on `TranscodeTask` — no schema change, no second pass. Two shapes were built and discarded first, both worth recording. (1) A `TagWriter` service porting the user's script: `node-id3` re-reading each mp3 puts main in the byte path (ADR-0003) to rewrite tags ffmpeg had just written from the same task; it also cannot *preserve* an existing artist as the script did, since `-map_metadata -1` means there is never one to preserve. (2) The script's derivation kept verbatim — split the name at the first `" ch"`. It is **unsound against generated names**: the filename embeds the *source's* chapter title, so a book whose chapters read `chapter three` splits mid-word (`apter three - 02`) while one reading `Chapter Three` does not split at all, and any lowercase `" ch"` in a real title (`the child`) fires too. The numbers were facts in the `OutputSpec` all along; parsing them back out of a name is the re-derivation ADR-0006 refuses. Not capped at 120 — that bound is the device filesystem's, not ID3's. Second unknown, still **open** and now the only thing blocking: **whether the watch displays tags at all is untested.** Spike A proved the *directory scan* is filenames-only and explicitly did not test the player — "they carry normal ID3 tags, but that's file content, not something the scan can see". If the player shows filenames, this whole question moves to ADR-0019's `deviceFilename` composition instead. Belongs in the same watch session as Spike C. | ADR-0019, Spike A, Spike C, CONTRACTS §6 |
| IPC input validation — what is checked, where | **Closed 08-11 — built, no ADR.** Shape and **id existence** at the Gateway (`main/ipc/validate.ipc`), which is what makes the Ack a real validation result. **State preconditions deliberately stay in the coordinators**: an item's state can change between the check and the act, so refusing on it at the edge is the same check-then-act race ARCHITECTURE §7.4 refuses elsewhere — and a mixed batch is better skipped per item than rejected whole. | ARCHITECTURE §4, ADR-0011 |
| Forge makers per target (dmg/NSIS/AppImage); per-target `resources/bin` in CI. *(The third part — "does Forge ad-hoc sign macOS" — is **answered 08-12: no, it signs nothing**; promoted to its own row above, because it is blocking rather than non-blocking.)* | Open — non-blocking. | ARCHITECTURE §9, §9.3 |
| **How `resources/bin` gets the right ffmpeg/ffprobe per platform.** *(08-11: **answered — build from source**, recipe in `resources/README.md`. No fetch step: a prebuilt static build is GPLv3 and ~80 MB per binary, carrying x264/x265/AV1 to encode mp3. A build with `--enable-libmp3lame` and neither `--enable-gpl` nor `--enable-version3` is LGPL, roughly a quarter the size, and `--disable-network` makes ADR-0014 a property of the binary rather than a promise. `npm run verify:bin` now checks presence, execute bit, static linkage, `libmp3lame` in `-encoders`, the round trip, and the licence posture — failing only on `--enable-nonfree`, which cannot be shipped at all. Remaining open: producing the pairs per platform/arch, and macOS.)* Gitignored, so every clone and CI run starts empty; the binaries are platform *and* arch specific. Wants a fetch step keyed on `process.platform`/`arch`. A build must satisfy **two independent properties**: **(a) static** — verify with `otool -L` / `ldd`, ideally "not a dynamic executable"; **(b) carries `libmp3lame`** — ffmpeg has no *native* mp3 encoder, so a stock build probes fine, lists `mp3` under `-muxers`, then dies at `Unknown encoder 'libmp3lame'`. The check is `-encoders`, not `-muxers`; a 1-second sine → mp3 → `ffprobe` round-trip is better still. | **Open — parked 07-22; (b) added 08-11.** Both surfaced live and were unblocked by hand (`EACCES` from ELF binaries on an arm64 Mac; then a hand-built 8.1.2 with no mp3 encoder). Now a static 7.0.2 build — GPLv3, a shipping question rather than a dev one. The repeatable story is deferred. | ARCHITECTURE §9.1–9.2 |
| Does a *packaged macOS* build spawn a bundled binary? | **Closed 08-12 — yes.** Spike B run on darwin arm64: same layout as Linux, `ffprobe`/`ffmpeg` spawn from `Contents/Resources/bin`, a real `libmp3lame` encode round-trips, `better-sqlite3` dlopens. The runtime questions are settled on both platforms. | Spike B |
| **The macOS build was invalidly signed, and quarantine was fatal.** Forge runs no signing step of its own: packager rewrites `Info.plist` and Fuses edits the Mach-O *after* Electron's inherited ad-hoc signature, so `npm run package` used to fail `codesign --verify` — running locally, then **blocked at exec** the moment it carried `com.apple.quarantine`, i.e. after any download. | **Closed 08-12 — built, no ADR.** A darwin-only `postPackage` hook ad-hoc signs the `.app`. ARCHITECTURE §9.3's *policy* survived; only its mechanics were wrong. The finding worth keeping is that the two failures are **not** the same failure: unsigned, **AMFI** rejects (`-420`, "signature is invalid") before policy runs, **no denial breadcrumb is written, and no override exists at any price**; ad-hoc signed, AMFI passes (`-423`, the benign code), policy denies on `team: (null)`, the breadcrumb *is* written, and **System Settings → Privacy & Security → Open Anyway works — confirmed on a real double-click.** An invalid signature is strictly worse than an untrusted one: it removes the escape hatch rather than presenting it. Still owed: the README line (the remedy is the Settings pane — right-click → Open was removed in Sequoia). `osxSign: {}` is **not** the fix — with no keychain identity the build dies unquarantined too. | ARCHITECTURE §9.3 |
| What "kill" means when a task is aborted — `SIGTERM` then `SIGKILL`, or `SIGKILL` outright; and whether the adapter waits for `exit` before resolving. | **Closed 08-12 — ADR-0032** (Proposed). `SIGKILL` at once: ffmpeg's `SIGTERM` path *finalises* the file we are about to delete, and on Windows `SIGTERM` is `TerminateProcess` anyway, so the ladder costs a timer and buys nothing on either platform. Settles on **`close`**, not `exit`, so the unlink cannot race the child's file handle; no timeout, because settling early frees a pool slot with a live child — the `N + K` overshoot ADR-0023 exists to prevent. Ratifies what `spawn.engine.ts` already did unrecorded. | ADR-0023, ADR-0032 |
| **macOS never grants the app access to the watch's volume.** TCC gates removable volumes per call: `stat` passes, `access(R_OK)`/`opendir`/`readdir` return `EPERM`. The bundle is ad-hoc signed (`TeamIdentifier=not set`) and carries no `NSRemovableVolumesUsageDescription`, so no prompt ever fires and no grant persists. The only access the app has had is the per-process **Powerbox** grant that comes with the folder picker — which is why re-picking the folder works and `[Rescan]` cannot, and why it must be re-picked every launch. | **Open — surfaced 08-17.** ADR-0045 makes the app *state* this rather than report the watch as unplugged; it does not obtain the permission. Two candidate halves, neither tested: `packagerConfig.extendInfo` adding the usage string, so a prompt can fire at all; and a Developer ID, so TCC can key the grant to a stable identity — an ad-hoc cdhash changes on every `npm run package`, so a Full Disk Access entry granted by hand is expected to lapse with the next build (unverified). Same family as the signing row above, and the reason it is no longer only a distribution concern: this one breaks the app on the developer's own machine. | ADR-0045, ADR-0016, ARCHITECTURE §9.3 |
| **Has column 2 earned a column?** | **Open — left open deliberately 08-17 by ADR-0047**, and carried here when the wireframe doc was retired. It now holds exactly one state (`processed`), and 0047's rejected option C folds it into column 1 with state as a row label. The answer depends on whether anyone still looks at it now that staging is somewhere else. | ADR-0047, ARCHITECTURE §10 |
| Log rotation policy (size, retained files) | Open — a bounded impl detail, not architectural. | ADR-0013 |
| **A damaged source exits 0, so a silent mp3 becomes a real row.** | **Open — surfaced 08-14 building the e2e suite.** ffmpeg asked for a segment past the end of a truncated source writes a 485-byte file with no audio and exits **0**. Nothing is wrong by the model's lights: the child succeeded, the file provably exists, so ADR-0007's row is written, ADR-0003 never fires, the item reaches `processed`, and the watch gets silence. The probe cannot catch it either — a faststart `moov` reports the duration the *container* claims, not the bytes present. Cheapest guard is a size or duration floor checked after the child exits, inside the Engine Adapter: a new failure *reason* on the existing path, not a new state. | ADR-0007, ADR-0003, ADR-0008 |

---

*When a decision lands: add its row to §1, its blast radius to §3, reconcile §2 and §4.
A decision with no blast-radius row is a decision nobody can review a diff against.*
