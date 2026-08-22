# CONTRACTS — the seams, in one page

**This file is the source for the *shape* of every seam** — the schema, the IPC
surface, the two adapter interfaces, the settings table. `ARCHITECTURE.md` carries
the *reasoning* and does not restate these shapes; where it describes a seam in
passing, this file wins.

**The decisions still outrank it.** If CONTRACTS and a decision in `DECISIONS.md`
disagree, the decision is right and this file is the bug.

```
docs/DECISIONS.md  >  docs/CONTRACTS.md  >  docs/ARCHITECTURE.md  >  the code
```

| Section | Reasoning lives in | Decided by |
|---|---|---|
| §1 Schema | ARCHITECTURE §6 | ADR-0005, ADR-0007, ADR-0020, ADR-0021 |
| §2 Transient shapes | ARCHITECTURE §6.4 | ADR-0007 |
| §3 Lifecycle | ARCHITECTURE §6.5 | ADR-0003, ADR-0023 |
| §4 IPC | ARCHITECTURE §5 | ADR-0011 (+ ADR-0013, ADR-0016, ADR-0017, ADR-0022 intents) |
| §5 Device Adapter | ARCHITECTURE §7.3–7.4 | ADR-0006, ADR-0009, ADR-0010, ADR-0015, ADR-0016 |
| §6 Engine Adapter | ARCHITECTURE §7.1 | ADR-0008, ADR-0023 |
| §7 Settings | ARCHITECTURE §8.1–8.2 | ADR-0012, ADR-0016 |

**Changing anything here is an architectural change.** It requires a new decision
row in `DECISIONS.md`, not an edit. Update this file only *after* that lands.

---

## 1. The schema — three tables, and no others

```
items                        state written ONLY by the Processing Coordinator (ADR-0021)
  id             PK
  groupId        string   generated at import; NOT a table
  groupName      string   folder name — display only
  sourcePath     string   the user's original — read in place, never mutated (ADR-0020)
  type           enum     'media' | 'audiobook'
  title          string   rewritten tag — editable
  author         string   rewritten tag — written by the app, NOT user-editable
  bitrate        int      NULLABLE — written when processing starts, from the live
                          setting; null means "not processed yet" (ADR-0036)
  splitEveryMin  int      audiobook only; nullable; written at the same moment
  state          enum     'imported' | 'processing' | 'processed' | 'ready'
  orderIndex     int      unique across all items of one `type`; mutable (ADR-0030)

outputs                      rows created/deleted ONLY by the Processing Coordinator;
                             onWatch written ONLY by the Sync Coordinator (ADR-0021)
  id             PK
  itemId         FK → items.id
  filePath       string   the mp3 in the managed library — the ONLY app-owned blob
  chapterIndex   int      nullable — media has no chapters
  chapterTitle   string   nullable
  partIndex      int      chunk within the chapter; 1 if unsplit
  deviceFilename string   IMMUTABLE. Composed (ADR-0019). Sanitised at generation.
  deviceFilenamePlain      IMMUTABLE. Undecorated sibling (ADR-0040).
                 string   Sync writes ONE of the two; both are device identity keys,
                          so every comparison matches EITHER.
  onWatch        bool     reconciled cache — the same fact as "synced"

settings                                  §7
  key            PK
  value
```

`items ||--o{ outputs` — media is `1 → 1`; an audiobook is `1 → N`. Same shape.

**No other table exists.** Not `jobs`, not `sessions`, not `scans`, not `collections`,
not `chapters`.

**Invariant — rows follow reality:** an Output row exists only when its mp3 actually
exists on disk. Rows are created *after* a confirmed write, never in anticipation.

**Invariant — ownership is per *column*, not per table (ADR-0021):** `items.state` is
the Processing Coordinator's; `outputs.onWatch` is the Sync Coordinator's; row creation
and deletion in **both** tables are the Processing Coordinator's, because only the
component that made a file can describe it. The other six columns on `outputs` are
birth facts, written once. The Repository exposes `onWatch` as **named calls**
(`markOnWatch` / `clearOnWatch`) — a generic `updateOutput(id, fields)` is the one
shape that would break this and must not exist.

**Derived, never stored:** item-level "synced" = `all(item.outputs.onWatch)`. Playback
order = flatten(media before audiobooks → group order → `item.orderIndex` →
`chapterIndex` → `partIndex`), where **group order is `min(orderIndex)` over its members**
— which is a real number only because `orderIndex` spans the type (ADR-0030).

---

## 2. Transient shapes — runtime only, never SQLite

```ts
Job              { itemId, expectedOutputs, completed, progress }   // in the Job Queue
TransferSession  { mode: 'append-new' | 'reorder-all',
                   ordered: OutputId[], cursor }                    // in the Sync Coordinator
DeviceScan       { files: { filename, sizeBytes, mtimeMs, ino,
                            managed: boolean }[] }                  // discarded after diff
```

`M` in "N of M" lives in `Job.expectedOutputs`, from the probe. It is **not in the
database**. `N` is `count(confirmed outputs)` — a fact, not a parsed percentage.

---

## 3. Lifecycle

**MediaItem.state** — Processing Coordinator only:

```
imported → processing → processed → ready
ready      → processed         (UNSTAGED:        `stage` backwards. One column write,
                                                 nothing deleted, `orderIndex` kept —
                                                 ADR-0047)
processing → imported          (child FAILED:    outputs deleted, item reverted,
                                                 notify + log line)
processing → imported          (CANCELLED:       outputs deleted, item reverted,
                                                 NO notify, NO log line)
processed  → imported          (REVERTED:        the same three steps, asked for
ready      → imported                            on purpose — ADR-0033)
```

`ready` is rendered at the **watch** (column 3), not beside `processed` — it is a claim about
the device, so it is shown where the device is. `unstage` is therefore a row leaving column 3,
and `revertItems` remains the expensive way out, reached from column 2. (ADR-0047)

There is **no `failed` state**. Failure = cleanup + revert + transient `notify`. Three
callers now run those same three steps for three reasons — failure loudly, cancel and
revert quietly (ADR-0003, ADR-0023, ADR-0033).

**Failure and cancel are the same transition and different handling** (ADR-0023). A
failed child is ADR-0003: notify the user and write ADR-0013's log line. A cancel is
quiet — the user asked for it, so there is nothing to tell them and nothing the model
forgot. The coordinator routes them apart on `err instanceof CancelledError`, never on
a message string.

**Output.onWatch** — Sync Coordinator only:

```
false → true    transfer CONFIRMED (i.e. the atomic rename succeeded)
true  → false   delete CONFIRMED, or not found on rescan
```

Only a **confirmed** device operation moves it. Never an intended one.

---

## 4. IPC (main ↔ renderer)

### The shape

Calls return a **receipt**, never a result. All state arrives on the event stream.

```ts
type Ack = { ok: true;  requestId: string }
         | { ok: false; error: { code: string; message: string } }
```

The Ack is the **IPC Gateway's validation result** — "your intent was well-formed and
routed" — not the operation's outcome.

**A rejected Ack is surfaced, not discarded.** The renderer's `invoke` turns `ok: false` into
an error toast. It is the only thing an Ack is for, and throwing it away made every malformed
or refused intent look like a button that did nothing.

### Intents (renderer → main). All return `Ack`.

| Intent | Payload | Owner |
|---|---|---|
| `import` | `{ type: 'media' \| 'audiobook', isFolder: boolean }` | Processing |
| `updateItem` | `{ itemId, title }` — **title only**; `author` is written by the app, never by the user | Processing |
| `process` | `{ itemIds: Id[] }` | Processing |
| `cancelProcessing` | `{ itemIds: Id[] }` | Processing |
| `stage` | `{ itemIds: Id[] }` — `processed → ready` | Processing |
| `unstage` | `{ itemIds: Id[] }` — `ready → processed`; keeps the mp3s, keeps `orderIndex`, never touches the device; refused mid-sync (ADR-0047) | Processing |
| `revertItems` | `{ itemIds: Id[] }` — `processed \| ready → imported`; deletes the outputs, never the device's copies (ADR-0033) | Processing |
| `reorder` | `{ type, ordered: ItemId[] }` — permutes the indices those rows hold; unlisted items never move (ADR-0030) | Processing |
| `deleteItems` | `{ itemIds: Id[] }` — library only; **no device call** (ADR-0022) | Processing |
| `scanDevice` | `{}` | Sync |
| `sync` | `{ mode: 'append-new' \| 'reorder-all', ordered: OutputId[] }` | Sync |
| `cancelSync` | `{}` — stops the running transfer **between files** (ADR-0025) | Sync |
| `deleteFromDevice` | `{ filenames: string[] }` — shape-validated at the Gateway (ADR-0029) | Sync |
| `selectDeviceFolder` | `{}` — opens the native picker, writes `mountPath` | Sync |
| `ejectDevice` | `{}` — asks the OS to unmount the volume; refused during a transfer (ADR-0034) | Sync |
| `hydrate` | `{}` — renderer boot; replies with a full `state:snapshot` on the event stream | Gateway |
| `getSettings` | `{}` — acks; the values arrive on `state:snapshot` (ADR-0024) | Gateway → Repository |
| `updateSettings` | a **partial patch**: key present = written, key absent = untouched, key `null` = **cleared back to the code default** (ADR-0024) | Gateway → Repository |
| `openLogFolder` | `{}` — `shell.openPath` | Gateway |
| `copyLogs` | `{}` — main reads the tail, `clipboard.writeText`, confirms via `notify` | Gateway |
| `openAppData` | `{}` — `shell.openPath(userData)`; path resolved in main, never from the renderer | Gateway |

`import` opens a **native dialog in main** (`dialog.showOpenDialog`), same pattern as
`selectDeviceFolder` — no path ever crosses IPC as a value; the new rows arrive on
`state:snapshot`. `isFolder` picks the dialog's mode (`openFile` vs `openDirectory`),
which is what the two import buttons' dropdowns select — it names *which* picker, not
*what was picked*, so ADR-0017's decision is unchanged. ADR-0017 also reserved a `paths?`
field for a future drag-drop affordance; it was never built and is not in the type.

The picker **reopens where the last import came from**, derived from the most recently inserted
`items.sourcePath` (by `rowid`, since `orderIndex` moves with a reorder). No seventh settings key:
the fact is already in the table, so storing it again would be the second copy that drifts
(ADR-0012). A folder picker gets the *parent* of that path, so a sibling album is one click. A
path that no longer exists is dropped rather than passed — a dead `defaultPath` is worse than none.

`sync` carries the **ordered list from the renderer** (order is a user decision —
the order these should *play* in). Main validates it — all ids exist, all `ready` —
before building the session, and **writes it in that order** — the player follows write order
(ADR-0044, superseding ADR-0035). Nothing runs backwards: the *listing* has no order to run in
either direction, so the seam sorts the scan by the field the watch itself sorts by (ADR-0049).

`deleteItems` is **local, synchronous and total**: cleanup by directory/prefix
(ADR-0003's primitive), then the Output rows, then the item row, then a
`state:snapshot`. It never consults `onWatch` and never touches the device, so it
has no failure path — an orphaned synced file simply shows up as `unmanaged` on the
next scan. It is **refused while the item is `processing`** (cancel first) with a
transient `notify`. There is deliberately **no `deleteOutput` intent** — an Output is
never the unit of a user's intent about the library. (ADR-0022)

### Events (main → renderer). Subscribe-only. Three channels.

| Event | Payload | Cadence |
|---|---|---|
| `state:snapshot` | `{ requestId?, items, outputs, device, settings }` — `device` is `{ reach, syncing, stopping, freeBytes, files: { filename, managed }[] }`, where `reach` is `'ok' \| 'unreachable' \| 'denied'` (ADR-0028 / ADR-0045) | Every lifecycle change. Coarse, self-healing. |
| `progress:delta` | `{ itemId, completed, expected }` \| `{ transfer: { done, total } }` | High-frequency. Never durable. |
| `notify` | `{ requestId?, level, message }` | Transient failure reasons. Never a persisted state. |

`device.files` is the last scan **in playback order** — the order is the payload's point
(ADR-0004's premise, rendered). That order is not `readdir`'s, which carries none (macOS sorts it
by name): the Sync Coordinator sorts the scan into **the watch's own key — `mtimeMs` ascending,
ties broken by `ino` — once, at the seam, before publishing (ADR-0049)**. The scan supplies
membership; the directory entry supplies position. It is still discarded in the sense that
matters: it never becomes rows, and `onWatch` remains its only durable trace (ADR-0006).
`syncing` and `stopping` are the Sync Coordinator's two flags, published rather than inferred —
`stopping` is `stopRequested`, and `cancelSync` emits so `[Stop]` can go dead on the click
rather than when the current file lands. Both are read live off the flags, so neither can be
left stuck by a missed reset. **The cache the `files` list comes from follows a confirmed
device operation** — a transfer's rename or a delete — so it is the last scan plus every
confirmed op since, not the last scan alone (ADR-0001).

### The preload surface — two verbs, fixed channel whitelist

```ts
window.api = {
  invoke(channel: Intent, payload: unknown): Promise<Ack>,
  subscribe(channel: 'state:snapshot' | 'progress:delta' | 'notify', fn): Unsubscribe
}
```

No `fs`, no `path`, no `ipcRenderer`, no Node. **That is the sandbox.**

**The state mirror has exactly one writer**: the event handler. There is no value to
await, so the renderer *cannot* write state from a return value.

---

## 5. Device Adapter — the watch

Nine calls. **All per-platform ugliness stops here.**

```ts
selectMount(): Promise<string | null>              // native folder picker; persists to settings
locateMount(): Promise<string | null>              // reads mountPath, VALIDATES it. Does not detect.
enumerate(mount): Promise<DeviceFile[]>            // { filename, sizeBytes, mtimeMs, ino } — ITS OWN ORDER MEANS NOTHING (ADR-0049)
copy(src, mount, tempName): Promise<void>          // writes "<deviceFilename>.part"
rename(mount, tempName, finalName): Promise<void>  // THE CONFIRMATION POINT
delete(mount, filename): Promise<void>
free(mount): Promise<number>                       // bytes — pre-flight check for a session
sanitise(name): string                             // FAT-safe, applied at GENERATION
eject(mount): Promise<void>                        // spawns; resolves the VOLUME first (ADR-0034)
```

**Failure is uniform:** every call rejects with `DeviceGone | IoError | Full | Denied`. There is
deliberately **no "check connected, then act" helper** — the call that must not exist,
whatever its position in this list. (Why: ARCHITECTURE §7.4.)

**`Denied`** is `EPERM`/`EACCES` — the OS forbids the call on a volume that is present. It is
raised **where the read happens**, never proved ahead of one: `locateMount()` still validates by
`stat` alone (ADR-0016), and `eject` needs no read permission at all. Only the **scan's**
`enumerate` may publish `reach: 'denied'`; a `Denied` from `copy` or `remove` is a refused write
on a watch that is still there. The remedy sentence is composed **here**, beside `eject`'s
platform table — it is the last place that may know which OS this is. (ADR-0045)

**`eject`** is the only call that is not a filesystem operation: no `fs` API unmounts a volume,
so it runs `diskutil eject` (darwin) or `gio mount -e` (linux) and reports an `IoError` naming
the platform anywhere else. It resolves the **volume root** itself by walking up from
`mountPath` while `stat().dev` holds, because ADR-0016's setting is a folder and may be a
subfolder of the volume. A missing *tool* is an `IoError`, never `DeviceGone`. Refused during a
transfer, and it never touches `onWatch` — the volume goes away, the files on it do not.

**`sanitise`** — strip `< > : " / \ | ? *` and control chars; collapse whitespace; trim
trailing dots/spaces; cap the stem at **120 chars** (headroom for the `(2)`
disambiguator and the `.part` suffix, both appended *after*); **keep** accents, dashes,
Unicode. One rule, every host OS — the constraint belongs to the *device's* filesystem.

---

## 6. Engine Adapter — ffmpeg

Two calls. **All CLI ugliness stops here.**

```ts
probe(sourcePath): Promise<{
  durationSec: number,
  chapters: { index, title, startSec, endSec }[]
}>

transcode(task, onProgress, signal): Promise<void>   // rejects { reason } on non-zero exit

type Task = {
  sourcePath, outPath,
  startSec, endSec,        // the cut
  bitrate,                 // per type — or 'source' to stream-copy (ADR-0043)
  title, author            // per-file tags — the reason one task = one child
}
```

**One task = one engine invocation = one child = one output file.** The probe is the
item's **first task**, inside the same pool. A probe failure is a job failure.

The pool is **flat and FIFO**. `N` is the number of ffmpeg children that may exist at
once — **one limiter, one resource**. The queue takes a **group key** for cancellation
and knows nothing else about the domain.

### Cancellation (ADR-0023) — the shape

```ts
submit(groupKey, run): Promise<T>   // `run` receives an AbortSignal, created at dispatch
cancelGroup(key): void              // drops pending entries; abort()s in-flight ones
class CancelledError extends Error  // exported from the queue module; carries its groupKey
```

Four rules, all load-bearing:

- The signal is created **at dispatch** — a pending task has nothing to abort.
- `cancelGroup` does **not** settle a running task's promise and does **not** free its
  slot. **The slot is released on unwind**, so `N` stays a truthful count of live
  children rather than `N + K` while the killed ones die.
- An aborted task's promise rejects with `CancelledError` **whatever `run` did** — the
  check pre-empts both success and failure. Domain code discriminates with `instanceof`.
- **Honouring the signal is the adapter's job.** The Engine Adapter kills its child and
  removes the partial mp3. The queue only signals, and stays domain-ignorant.

**Two tiers, one error type.** The queue's signal covers a task; the gaps *between* an
item's tasks are the Processing Coordinator's own `AbortController`. The two are **not
chained**, and both reject with `CancelledError`. Why, and where the gap is: ARCHITECTURE §7.2.

**Kill means `SIGKILL`, at once** — no `SIGTERM` ladder, because ffmpeg's graceful
shutdown *finalises* the file we are about to delete. The adapter settles on **`close`**,
not `exit`, so the partial mp3 is unlinked only once the child has released it; there is
no timeout, because settling early would free a pool slot with a live child. (ADR-0032)

---

## 7. Settings — eight keys

**Live** = read at act time by the component that acts. Effective immediately. Since ADR-0036
there is **no seed side**: the three keys that were seeds are read when Process is pressed, not
when the file was imported. `bitrate` and `splitEveryMin` are still *recorded* on the row
afterwards — as what the mp3s were made with, not as a value that governs a later run. `bitrate`
is written **after the probe**, since a `media` source already mp3 at or under target is copied
and the row then records the source's own bitrate (ADR-0043).

| Key | Kind | Default | Read by |
|---|---|---|---|
| `bitrateMedia` | live | 128 | Processing Coordinator, at **Process** → recorded on `item.bitrate` *(the source's, if it was copied — ADR-0043)* |
| `bitrateAudiobook` | live | 64 | Processing Coordinator, at **Process** → recorded on `item.bitrate` |
| `splitEveryMin` | live | 10 | Processing Coordinator, at **Process** → recorded on `item.splitEveryMin` |
| `concurrency` (**N**) | live | `max(1, cores − 1)` | Job Queue, per spawn |
| `logLevel` | live | `info` | Logger |
| `mountPath` | live | *(none — prompt)* | Device Adapter, per `locateMount()` |
| `renameAudiobook` | live | `true` | Sync Coordinator, **once per session** (ADR-0040) |
| `renameMedia` | live | `false` | Sync Coordinator, **once per session** (ADR-0040) |

```
N = max(1, setting ?? os.cpus().length - 1)
```
User's number honoured **verbatim** — no upper clamp. **Floor of 1** (0 is a broken app,
not a configured one). N is the app's **only** concurrency knob.

**Every read is `setting ?? codeDefault`.** No component may assume the row exists. A
settings table that is absent, corrupt, or one migration behind may stop the app being
*configured*; it may never stop it *working*.

The two `rename*` keys pick which of an output's two immutable names sync writes; they are
read **once at the top of a session**, never per file, so one transfer cannot be split across
two naming schemes (ADR-0040).

**The code defaults live in exactly one module** (`main/adapters/db/settings`), which is
what makes the rule above enforceable rather than aspirational — six inline `??`s is how
two of them end up disagreeing. The renderer receives **effective** values on
`state:snapshot` and never learns a default (ADR-0024).

**Not settings:** `type` (a per-import UI choice). The library location (fixed at
`userData/library` — making it configurable means owning a migration).

---

## 8. Fixed paths

```
userData/library/    the managed library — produced mp3s ONLY; sources are read
                     in place and never copied here (ADR-0020)
userData/app.db      SQLite — items, outputs, settings
userData/logs/       rotated files; written by main only; never crosses IPC
resources/bin/       ffmpeg, ffprobe — outside the asar via Forge extraResource
app.asar.unpacked/   better_sqlite3.node — outside the asar via AutoUnpackNativesPlugin
```

Two different Forge mechanisms, not one — see ARCHITECTURE §9.1. Both exist because the
OS opens these directly (spawn, dlopen) and neither can live inside the asar
archive.

A **single binary-path resolver in main** is the only code that knows about
`app.isPackaged`, `process.resourcesPath`, and `.exe`. Adapters ask it for a binary;
they never construct a path.

**The app makes zero network requests, in any code path.**
