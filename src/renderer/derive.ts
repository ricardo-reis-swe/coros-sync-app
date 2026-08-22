import { DeviceEntry, Item, ItemType, Output } from '../shared/data.types';

/** Group → item is a projection of `groupId`; there is no folder entity. (ADR-0005) */
export type Group = { groupId: string; groupName: string; items: Item[] };

/** Column 2 is "the mp3s exist", and keeps the row once they do; staged is column 3's to say. (ADR-0047) */
export const isTranscoded = (item: Item) => item.state === 'processed' || item.state === 'ready';

/** Column 3's staged region: `ready` is a claim about the watch, so it is rendered at the watch. */
export const isStaged = (item: Item) => item.state === 'ready';

/** A group of one renders as a bare row; only a group of several earns a folder. */
export const isFolder = (group: Group) => group.items.length > 1;

export const groupsOf = (items: Item[], type: ItemType): Group[] => {
    const byId = new Map<string, Group>();

    for (const item of items.filter((candidate) => candidate.type === type)) {
        const group = byId.get(item.groupId) ?? {
            groupId: item.groupId,
            groupName: item.groupName,
            items: [],
        };
        group.items.push(item);
        byId.set(item.groupId, group);
    }

    for (const group of byId.values()) {
        group.items.sort((a, b) => a.orderIndex - b.orderIndex);
    }

    // Group order is its lowest member; ADR-0030 is what will make that unambiguous.
    return [...byId.values()].sort(
        (a, b) =>
            Math.min(...a.items.map((i) => i.orderIndex)) -
                Math.min(...b.items.map((i) => i.orderIndex)) ||
            a.groupName.localeCompare(b.groupName),
    );
};

/** The same order a Cell renders, flattened — so the numbering cannot drift from the list. */
export const orderedItems = (items: Item[], type: ItemType): Item[] =>
    groupsOf(items, type).flatMap((group) => group.items);

export const outputsOf = (outputs: Output[], itemId: string): Output[] =>
    outputs
        .filter((output) => output.itemId === itemId)
        .sort((a, b) => (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0) || a.partIndex - b.partIndex);

/** A part tick sets it too: staging is item-level, so a `[-]` book is still `[Stage]`'s work. */
export const isPicked = (item: Item, outputs: Output[], selected: Set<string>): boolean =>
    selected.has(item.id) || outputsOf(outputs, item.id).some((output) => selected.has(output.id));

/** The partial form of "synced": the same `all(onWatch)` fact, counted. (ADR-0007) */
export const syncedCount = (outputs: Output[], itemId: string) => {
    const mine = outputs.filter((output) => output.itemId === itemId);
    return { completed: mine.filter((output) => output.onWatch).length, total: mine.length };
};

export const isSynced = (outputs: Output[], itemId: string) => {
    const { completed, total } = syncedCount(outputs, itemId);
    return total > 0 && completed === total;
};

/** Items done / items in the group — items, never outputs. The two counters differ. */
export const groupProgress = (group: Group) => ({
    completed: group.items.filter((item) => item.state === 'processed' || item.state === 'ready')
        .length,
    total: group.items.length,
});

export const partLabel = (output: Output) => {
    const chapter = output.chapterIndex != null ? `ch${String(output.chapterIndex).padStart(2, '0')}` : null;
    const part = `p${output.partIndex}`;
    return [output.chapterTitle ?? chapter, part].filter(Boolean).join(' ');
};

/** Positional, not `!onWatch`: a part before the last one on the watch was listened to and deleted. */
export const partsAfterWatched = (parts: Output[]): Output[] => {
    const last = parts.reduce((at, output, index) => (output.onWatch ? index : at), -1);

    return parts.slice(last + 1);
};

/** Under a chapter row the chapter is the parent, so the part says only which part it is. */
export const partOnlyLabel = (output: Output) => `p${output.partIndex}`;

export type Chapter = { key: string; label: string; outputs: Output[] };

/** A `groupBy` on a column, never a table — the Book → Chapter → Part tree is a projection. (ADR-0005) */
export const chaptersOf = (parts: Output[]): Chapter[] => {
    const chapters: Chapter[] = [];

    for (const output of parts) {
        const key = String(output.chapterIndex ?? '');
        const last = chapters[chapters.length - 1];

        if (last && last.key === key) last.outputs.push(output);
        else chapters.push({ key, label: chapterLabelOf(output), outputs: [output] });
    }

    return chapters;
};

const chapterLabelOf = (output: Output) =>
    output.chapterTitle ??
    (output.chapterIndex != null ? `ch${String(output.chapterIndex).padStart(2, '0')}` : 'Parts');

/** One file on the watch, carrying its position in the device's own order. (ADR-0028) */
export type DeviceRow = { file: DeviceEntry; index: number; output?: Output };

export type DeviceNode =
    | { kind: 'file'; row: DeviceRow }
    | { kind: 'book'; key: string; item: Item; rows: DeviceRow[]; chapters: Chapter[] };

/** Grouped by *runs*, not by item: a book interrupted by a track is two runs on the watch. (ADR-0028) */
export const deviceNodes = (files: DeviceEntry[], outputs: Output[], items: Item[]): DeviceNode[] => {
    const byFilename = new Map(outputs.map((output) => [output.deviceFilename, output]));
    const byId = new Map(items.map((item) => [item.id, item]));
    const nodes: DeviceNode[] = [];

    files.forEach((file, index) => {
        const output = byFilename.get(file.filename);
        const item = output ? byId.get(output.itemId) : undefined;
        const row: DeviceRow = { file, index, output };

        // Only an audiobook groups: media is 1 → 1, and an unmanaged file has no item at all.
        if (!item || !output || item.type !== 'audiobook') {
            nodes.push({ kind: 'file', row });
            return;
        }

        const last = nodes[nodes.length - 1];
        if (last?.kind === 'book' && last.item.id === item.id) last.rows.push(row);
        else nodes.push({ kind: 'book', key: `${item.id}:${index}`, item, rows: [row], chapters: [] });
    });

    // Chapters are runs within a run, for the same reason.
    for (const node of nodes) {
        if (node.kind === 'book') {
            node.chapters = chaptersOf(node.rows.map((row) => row.output as Output));
        }
    }

    return nodes;
};

export const titleOf = (item: Item) => item.title || item.sourcePath.split('/').pop() || item.id;

/** A staged item the list says nothing about contributes all of it — what a restart leaves. (ADR-0053) */
export const listedOutputIds = (item: Item, outputs: Output[], sendList: Set<string>): string[] => {
    const parts = outputsOf(outputs, item.id).map((output) => output.id);
    const listed = parts.filter((id) => sendList.has(id));

    return listed.length > 0 ? listed : parts;
};

/** The wipe is total, so what is on the watch and outside the list is what a rebuild removes. (ADR-0050) */
export const rebuildCost = (session: string[], outputs: Output[]): string => {
    const sent = new Set(session);
    const lost = outputs.filter((output) => output.onWatch && !sent.has(output.id)).length;
    const files = lost === 1 ? 'file' : 'files';

    return (
        `Reorder all deletes every managed file, then copies back the ${session.length} in the list. ` +
        (lost > 0 ? `${lost} ${files} on the watch ${lost === 1 ? 'is' : 'are'} not in it and will not come back. ` : '') +
        'Continue?'
    );
};

/** Exactly what `[Sync]` will send, so the button can count it — main's `buildSession`, read here. */
export const sessionOutputIds = (
    ordered: Item[],
    outputs: Output[],
    sendList: Set<string>,
    mode: 'append-new' | 'reorder-all',
): string[] => {
    // Walked in playback order, never gathered from the set: type → group → item → chapter → part. (ADR-0004)
    const list = ordered.flatMap((item) => listedOutputIds(item, outputs, sendList));
    // The modes differ in this alone: a rebuild rewrites what is already there.
    if (mode === 'reorder-all') return list;

    const onWatch = new Set(outputs.filter((output) => output.onWatch).map((output) => output.id));
    return list.filter((id) => !onWatch.has(id));
};
