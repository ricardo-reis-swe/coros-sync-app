import { ChevronDown, ChevronRight, Info, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { DeviceState, Item, Output } from '../shared/data.types';
import Cell, { RowPlan } from './Cell';
import {
    Chapter,
    DeviceNode,
    DeviceRow,
    deviceNodes,
    isSynced,
    partOnlyLabel,
    syncedCount,
    titleOf,
} from './derive';

export type SyncMode = 'append-new' | 'reorder-all';

/** The wire values stay as they are — twice now only the *label* moved, never the intent. (ADR-0044) */
const MODES: Record<SyncMode, { label: string; info: string }> = {
    'append-new': {
        label: 'Add to the end',
        info: 'Newly copied files play after everything already on the watch — this appends, it does not put them first. The divider is the line it cannot cross.',
    },
    'reorder-all': {
        label: 'Reorder all',
        info: 'The watch cannot be reordered in place: every managed file is deleted first, then the list below the line is copied back, in its order — ticked means already on the watch, grey means not there yet. Above the line is what is on the watch now, so anything up there and not in the list below will not come back. Stage a subset and that list becomes the whole of what the watch will hold. Sideloaded files survive and cannot be placed.',
    },
};

type DeviceColumnProps = {
    device: DeviceState;
    items: Item[];
    outputs: Output[];
    mountPath: string | null;
    transfer: { done: number; total: number } | null;
    /** Exactly what `[Sync]` will send, in playback order — the staged region *is* this list. */
    session: string[];
    mode: SyncMode;
    onModeChange: (mode: SyncMode) => void;
    onSync: () => void;
    onStop: () => void;
    onUnstage: (itemIds: string[]) => void;
    onDiscard: (outputIds: string[]) => void;
    onReorder: (dragged: string, target: string) => void;
    onRescan: () => void;
    onDeleteFile: (filenames: string[], managed: boolean) => void;
    onEject: () => void;
};

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB free`;

const DeviceColumn = ({
    device,
    items,
    outputs,
    mountPath,
    transfer,
    session,
    mode,
    onModeChange,
    onSync,
    onStop,
    onUnstage,
    onDiscard,
    onReorder,
    onRescan,
    onDeleteFile,
    onEject,
}: DeviceColumnProps) => {
    // Tracks what is OPEN, so the default is closed — a 146-part book must not open 151 rows. (ADR-0047)
    const [opened, setOpened] = useState<Set<string>>(new Set());

    const toggle = (key: string) =>
        setOpened((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const { syncing, stopping } = device;

    // Unfiltered in both modes: a row shown only here is one a rebuild will not put back. (ADR-0050)
    const nodes = deviceNodes(device.files, outputs, items);

    // The region is the session, not "every ready item", so a rebuilt row shows in both. (ADR-0050)
    const sessionIds = new Set(session);
    const stagedOutputs = outputs.filter((output) => sessionIds.has(output.id));
    const stagedItems = items.filter((item) =>
        stagedOutputs.some((output) => output.itemId === item.id),
    );

    // Both regions in both modes; the line joins a fact to a plan rather than bounding a mode. (ADR-0050)
    const showStaged = session.length > 0;

    // An append plays after what is up there; a rebuild renumbers from one, all of it being rewritten.
    const offset =
        mode === 'append-new' ? device.files.filter((file) => file.managed).length : 0;
    const numberOf = (itemId: string) => {
        const at = session.findIndex(
            (id) => stagedOutputs.find((output) => output.id === id)?.itemId === itemId,
        );
        return at === -1 ? undefined : offset + at + 1;
    };

    const plan = (item: Item): RowPlan => {
        const { completed, total } = syncedCount(stagedOutputs, item.id);
        const done = isSynced(stagedOutputs, item.id);
        const shape: RowPlan = {
            number: numberOf(item.id),
            expandable: true,
            badge: item.bitrate ? `${item.bitrate}k` : undefined,
        };

        if (syncing && !done) {
            // No ↺ and no ⇤ while it runs: a stop is the session's, and the order must not move.
            return { ...shape, grey: true, spinning: true, counter: total > 1 ? { completed, expected: total } : null };
        }

        // Grey is `!onWatch` and carries the hedge too: not there yet, and not promised. (ADR-0047)
        return { ...shape, grey: !done, tick: done, draggable: !syncing, unstageable: !syncing };
    };

    // Four empty states, told apart by `mountPath` and `reach` — both already on the snapshot.
    const empty = () => {
        if (mountPath === null) {
            return (
                <p className="cell-empty">
                    No watch folder chosen yet.
                    <small>Use Choose Music folder in the header.</small>
                </p>
            );
        }
        if (device.reach === 'denied') {
            // Named rather than duplicated: the header's picker is never hidden. (ADR-0045)
            return (
                <p className="cell-empty">
                    The system is blocking access to <code>{mountPath}</code>.
                    <small>
                        Use Choose Music folder in the header — re-picking it is what grants access,
                        until you quit.
                    </small>
                </p>
            );
        }
        if (device.reach === 'unreachable') {
            // `locateMount` validates rather than detects, so "set but unreachable" is normal. (ADR-0016)
            return (
                <p className="cell-empty">
                    Can’t reach <code>{mountPath}</code> — is the watch plugged in?
                </p>
            );
        }
        return <p className="cell-empty">Nothing on the watch.</p>;
    };

    /** The trash takes a list, so a book or a chapter is one call, not one per part. */
    const actions = (filenames: string[], managed: boolean) => (
        <span className="row-tail">
            {!managed && <em>unmanaged</em>}
            <button
                className="row-icon"
                title="Delete from the watch"
                disabled={syncing}
                onClick={() => onDeleteFile(filenames, managed)}
            >
                <Trash2 size={14} />
            </button>
        </span>
    );

    const fileRow = (row: DeviceRow, depth: number) => (
        <div
            key={row.file.filename}
            className={`row${row.file.managed ? '' : ' row-unmanaged'}`}
            style={{ paddingLeft: `${depth * 1.1}rem` }}
        >
            <span className="row-number">
                {row.file.managed ? (
                    String(row.index + 1).padStart(2, '0')
                ) : (
                    <TriangleAlert size={13} />
                )}
            </span>
            <span className="row-label" title={row.file.filename}>
                {depth > 0 && row.output ? partOnlyLabel(row.output) : row.file.filename}
            </span>
            {actions([row.file.filename], row.file.managed)}
        </div>
    );

    const parentRow = (key: string, label: string, count: number, filenames: string[], depth: number) => {
        // Closed by default, or one 146-part book opens the column 151 rows tall. (ADR-0047)
        const open = opened.has(key);

        return (
            <div className="row" style={{ paddingLeft: `${depth * 1.1}rem` }}>
                <button className="row-arrow" onClick={() => toggle(key)} aria-label="Expand">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <span className="row-label" title={label}>
                    {label}
                </span>
                <span className="row-counter">{count}</span>
                {actions(filenames, true)}
            </div>
        );
    };

    const chapterBlock = (node: Extract<DeviceNode, { kind: 'book' }>, chapter: Chapter) => {
        const key = `${node.key}:${chapter.key}`;
        const rows = node.rows.filter((row) => row.output && chapter.outputs.includes(row.output));
        const filenames = rows.map((row) => row.file.filename);

        return (
            <div key={key}>
                {parentRow(key, chapter.label, rows.length, filenames, 1)}
                {opened.has(key) && rows.map((row) => fileRow(row, 2))}
            </div>
        );
    };

    const bookBlock = (node: Extract<DeviceNode, { kind: 'book' }>) => {
        const filenames = node.rows.map((row) => row.file.filename);

        return (
            <div key={node.key}>
                {parentRow(node.key, titleOf(node.item), node.rows.length, filenames, 0)}
                {opened.has(node.key) &&
                    // One chapter is not a level worth drawing — its parts sit straight under the book.
                    (node.chapters.length > 1
                        ? node.chapters.map((chapter) => chapterBlock(node, chapter))
                        : node.rows.map((row) => fileRow(row, 1)))}
            </div>
        );
    };

    // No `selected`/`onSelect`: the list is built in column 2, so it cannot shrink under a click here. (ADR-0053)
    const shared = {
        items: stagedItems,
        outputs: stagedOutputs,
        plan,
        onCancel: () => undefined,
        onUnstage,
        // Withheld mid-session for the reason `unstageable` is: the running order must not move.
        onDiscard: syncing ? undefined : onDiscard,
        onDropOn: onReorder,
    };

    return (
        <div
            className="column column-device"
            style={{
                gridTemplateRows: [
                    'auto',
                    'minmax(0, 1fr)',
                    showStaged ? 'auto' : null,
                    showStaged ? 'minmax(0, 1fr)' : null,
                    'auto',
                ]
                    .filter(Boolean)
                    .join(' '),
            }}
        >
            <header className="column-head">
                <h2 className="column-title">Watch</h2>
                {syncing ? (
                    // Dead the moment it is pressed: the stop lands between files, not on click. (ADR-0025)
                    <button onClick={onStop} disabled={stopping}>
                        {stopping ? (
                            <span className="button-busy">
                                <LoaderCircle className="row-spinner" size={12} />
                                Stopping
                            </span>
                        ) : (
                            'Stop'
                        )}
                    </button>
                ) : (
                    <span
                        className="with-info"
                        data-info="Copies everything below the divider to the watch, one file at a time, in the order shown — which is the order it plays in. It is built in column 2 with Stage, and `⇤` takes a row back off it."
                    >
                        <button onClick={onSync} disabled={session.length === 0}>
                            {session.length > 0 ? `Sync (${session.length})` : 'Sync'}
                        </button>
                        <Info className="info-mark" size={13} />
                    </span>
                )}
                {/* Dead during a session: a scan sweeps `.part` files, and one is being written. */}
                <button onClick={onRescan} disabled={mountPath === null || syncing}>
                    Rescan
                </button>
                {/* Live while denied: `diskutil` needs no read permission, so letting go still works. (ADR-0045) */}
                <button
                    onClick={onEject}
                    disabled={device.reach === 'unreachable' || syncing}
                    title="Unmount the watch's volume"
                >
                    Eject
                </button>
                <span className="mode">
                    {(Object.keys(MODES) as SyncMode[]).map((option) => (
                        <label key={option}>
                            <input
                                type="radio"
                                checked={mode === option}
                                disabled={syncing}
                                onChange={() => onModeChange(option)}
                            />
                            {MODES[option].label}
                            {/* On the mark, not the label: the label is a hit area for choosing the mode. */}
                            <span className="mode-info" data-info={MODES[option].info}>
                                <Info size={12} />
                            </span>
                        </label>
                    ))}
                </span>
            </header>

            {/* Classed, not merely positioned: both the styles and the e2e selectors need to name it
                apart from the staged cell. (ADR-0047) */}
            <section className="cell cell-on-watch">
                <div className="cell-body">
                    {device.files.length === 0 && empty()}
                    {nodes.map((node) =>
                        node.kind === 'book' ? bookBlock(node) : fileRow(node.row, 0),
                    )}
                </div>
            </section>

            {/* The line joins the watch to the plan; under an append it is also the boundary it cannot cross. (ADR-0044, ADR-0050) */}
            {showStaged && (
                <p className="staged-line">
                    {mode === 'append-new'
                        ? 'staged — plays after the above'
                        : 'staged — the watch is deleted and rebuilt as this list'}
                </p>
            )}
            {showStaged && <Cell type={['media', 'audiobook']} {...shared} />}

            <footer className="cell-foot">
                {transfer && (
                    <span>
                        transferring {transfer.done}/{transfer.total}
                    </span>
                )}
                {device.freeBytes != null && <span>{gigabytes(device.freeBytes)}</span>}
            </footer>
        </div>
    );
};

export default DeviceColumn;
