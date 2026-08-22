import { randomUUID } from 'crypto';
import { Item, Output, SettingsType } from '../../../shared/data.types';
import db from './db';
import {
    ItemRow,
    OutputRow,
    toItem,
    toItemRow,
    toItemRowPartial,
    toOutput,
    toOutputRow,
} from './db.mappers';

/* ---------- items ---------- */

/** The `id` tiebreak: index spaces are per type, so two rows can share a number. (ADR-0030) */
export const getItems = (): Item[] => {
    const rows = db.prepare(`SELECT * FROM items ORDER BY orderIndex, id`).all() as ItemRow[];
    return rows.map(toItem);
};

/** Where the last import came from — derived, so it needs no settings key of its own. (ADR-0012) */
export const lastImportedSource = (): string | null => {
    // `rowid` is insertion order; `orderIndex` is not, because a reorder moves it. (ADR-0030)
    const row = db.prepare(`SELECT sourcePath FROM items ORDER BY rowid DESC LIMIT 1`).get() as
        | { sourcePath: string }
        | undefined;

    return row?.sourcePath ?? null;
};

export const nextOrderIndex = (type: string): number => {
    const row = db
        .prepare(`SELECT COALESCE(MAX(orderIndex), -1) + 1 AS next FROM items WHERE type = ?`)
        .get(type) as { next: number };
    return row.next;
};

/** Permutes the indices those rows already hold; anything unlisted keeps its place. (ADR-0030) */
export const reorderItems = db.transaction((itemIds: string[]): void => {
    const slots = itemIds
        .map((id) => (db.prepare(`SELECT orderIndex FROM items WHERE id = ?`).get(id) as { orderIndex: number } | undefined))
        .filter((row): row is { orderIndex: number } => row !== undefined)
        .map((row) => row.orderIndex)
        .sort((a, b) => a - b);

    const write = db.prepare(`UPDATE items SET orderIndex = ? WHERE id = ?`);
    itemIds.forEach((id, at) => write.run(slots[at], id));
});

export const getItem = (id: string): Item | undefined => {
    const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
};

export const updateItem = (id: string, fields: Partial<Omit<Item, 'id'>>): Item | undefined => {
    const keys = Object.keys(fields);
    if (keys.length === 0) return getItem(id);

    const setClause = keys.map((key) => `${key} = @${key}`).join(', ');
    const row = db
        .prepare(`UPDATE items SET ${setClause} WHERE id = @id RETURNING *`)
        .get({ ...toItemRowPartial(fields), id }) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
};

export const insertItem = (item: Omit<Item, 'id'>): string => {
    const id = randomUUID();

    db.prepare(
        `
            INSERT INTO items (
                id, state, groupId, groupName, sourcePath,
                type, title, author, bitrate, splitEveryMin, orderIndex
            ) VALUES (
                @id, @state, @groupId, @groupName, @sourcePath,
                @type, @title, @author, @bitrate, @splitEveryMin, @orderIndex
            )
        `,
    ).run({ ...toItemRow(item), id } as Item);

    return id;
};

export const deleteItem = (id: string): boolean => {
    const result = db.prepare(`DELETE FROM items WHERE id = ?`).run(id);
    return result.changes > 0;
};

/* ---------- outputs ---------- */

export const getOutputsByItemId = (itemId: string): Output[] => {
    const rows = db
        .prepare(`SELECT * FROM outputs WHERE itemId = ? ORDER BY chapterIndex, partIndex`)
        .all(itemId) as OutputRow[];
    return rows.map(toOutput);
};

export const getOutput = (id: string): Output | undefined => {
    const row = db.prepare(`SELECT * FROM outputs WHERE id = ?`).get(id) as OutputRow | undefined;
    return row ? toOutput(row) : undefined;
};

export const getAllOutputs = (): Output[] => {
    const rows = db
        .prepare(`SELECT * FROM outputs ORDER BY chapterIndex, partIndex`)
        .all() as OutputRow[];
    return rows.map(toOutput);
};

export const insertOutput = (output: Omit<Output, 'id'>): string => {
    const id = randomUUID();

    db.prepare(
        `
        INSERT INTO outputs (
            id, itemId, filePath, chapterIndex, chapterTitle,
            partIndex, deviceFilename, deviceFilenamePlain, onWatch
        ) VALUES (
            @id, @itemId, @filePath, @chapterIndex, @chapterTitle,
            @partIndex, @deviceFilename, @deviceFilenamePlain, @onWatch
        )
    `,
    ).run({ ...toOutputRow(output), id });

    return id;
};

/** Sync's only writes. Two named calls, and no generic `updateOutput` — that shape breaks 0021. */
const writeOnWatch = (id: string, value: 0 | 1): boolean =>
    db.prepare(`UPDATE outputs SET onWatch = ? WHERE id = ?`).run(value, id).changes > 0;

export const markOnWatch = (id: string): boolean => writeOnWatch(id, 1);

export const clearOnWatch = (id: string): boolean => writeOnWatch(id, 0);

// No single-row `deleteOutput`: row deletion is by item. (ADR-0022)
export const deleteOutputsByItemId = (itemId: string): number => {
    const result = db.prepare(`DELETE FROM outputs WHERE itemId = ?`).run(itemId);
    return result.changes;
};

/* ---------- settings (key/value) ---------- */

export const getSetting = (key: SettingsType): string | undefined => {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
        { value: string } | undefined;
    return row?.value;
};

export const setSetting = (key: SettingsType, value: string): void => {
    db.prepare(
        `
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    ).run(key, value);
};

/** Clearing a key is how a setting returns to its code default — there is no "unset" value. */
export const deleteSetting = (key: SettingsType): void => {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
};
