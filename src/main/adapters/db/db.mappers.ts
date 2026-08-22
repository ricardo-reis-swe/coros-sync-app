import { Item, Output } from '../../../shared/data.types';

/* ---------- storage shapes (adapter-private, never leaves this module) ---------- */
export type ItemRow = {
    id: string;
    state: Item['state'];
    groupId: string;
    groupName: string;
    sourcePath: string;
    type: Item['type'];
    title: string | null;
    author: string | null;
    bitrate: number | null;
    splitEveryMin: number | null;
    orderIndex: number;
};

export type OutputRow = {
    id: string;
    itemId: string;
    filePath: string;
    chapterIndex: number | null;
    chapterTitle: string | null;
    partIndex: number;
    deviceFilename: string;
    deviceFilenamePlain: string;
    onWatch: 0 | 1;
};

/* ---------- mappers (pure, total, no I/O) ---------- */

export const toItem = (row: ItemRow): Item => ({
    id: row.id,
    state: row.state,
    groupId: row.groupId,
    groupName: row.groupName,
    sourcePath: row.sourcePath,
    type: row.type,
    title: row.title ?? undefined,
    author: row.author ?? undefined,
    bitrate: row.bitrate ?? undefined,
    splitEveryMin: row.splitEveryMin ?? undefined,
    orderIndex: row.orderIndex,
});

export const toOutput = (row: OutputRow): Output => ({
    id: row.id,
    itemId: row.itemId,
    filePath: row.filePath,
    chapterIndex: row.chapterIndex ?? undefined,
    chapterTitle: row.chapterTitle ?? undefined,
    partIndex: row.partIndex,
    deviceFilename: row.deviceFilename,
    deviceFilenamePlain: row.deviceFilenamePlain,
    onWatch: row.onWatch === 1,
});

export const toItemRow = (item: Omit<Item, 'id'>): Omit<ItemRow, 'id'> => ({
    state: item.state,
    groupId: item.groupId,
    groupName: item.groupName,
    sourcePath: item.sourcePath,
    type: item.type,
    title: item.title ?? null,
    author: item.author ?? null,
    bitrate: item.bitrate ?? null,
    splitEveryMin: item.splitEveryMin ?? null,
    orderIndex: item.orderIndex,
});

export const toOutputRow = (o: Omit<Output, 'id'>): Omit<OutputRow, 'id'> => ({
    itemId: o.itemId,
    filePath: o.filePath,
    chapterIndex: o.chapterIndex ?? null,
    chapterTitle: o.chapterTitle ?? null,
    partIndex: o.partIndex,
    deviceFilename: o.deviceFilename,
    deviceFilenamePlain: o.deviceFilenamePlain,
    onWatch: o.onWatch ? 1 : 0,
});

// Per provided key: undefined -> null, so better-sqlite3 never sees `undefined`.
export const toItemRowPartial = (
    fields: Partial<Omit<Item, 'id'>>,
): Record<string, string | number | null> => {
    const row: Record<string, string | number | null> = {};
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
        const value = fields[key];
        row[key] = value === undefined ? null : value;
    }
    return row;
};
