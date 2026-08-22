import { ITEM_TYPE, ItemType, LOG_LEVELS, LogLevel, SettingsType } from '../../shared/data.types';
import { getItem, getOutput } from '../adapters/db/db.queries';

/** Shape and id existence only; state stays in the coordinators. Throws become `ok: false`. (ADR-0011) */

const invalid = (channel: string, detail: string): never => {
    throw new Error(`${channel}: ${detail}`);
};

const record = (channel: string, payload: unknown): Record<string, unknown> => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return invalid(channel, 'payload must be an object');
    }
    return payload as Record<string, unknown>;
};

const optionalString = (channel: string, value: unknown, field: string): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return invalid(channel, `${field} must be a string`);
    return value;
};

/** A blank title is a cleared title, not the string `""` — nothing downstream may render it. */
const blankToUndefined = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

const ids = (channel: string, payload: unknown, field: string): string[] => {
    const value = record(channel, payload)[field];

    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id === '')) {
        return invalid(channel, `${field} must be an array of ids`);
    }
    if (value.length === 0) return invalid(channel, `${field} is empty`);

    return value as string[];
};

export const validateImport = (payload: unknown): { type: ItemType; isFolder: boolean } => {
    const fields = record('import', payload);

    if (!ITEM_TYPE.includes(fields.type as ItemType)) {
        return invalid('import', `type must be one of ${ITEM_TYPE.join(', ')}`);
    }
    if (typeof fields.isFolder !== 'boolean') {
        return invalid('import', 'isFolder must be a boolean');
    }

    return { type: fields.type as ItemType, isFolder: fields.isFolder };
};

export const validateItemIds = (channel: string, payload: unknown): string[] => {
    const itemIds = ids(channel, payload, 'itemIds');

    for (const itemId of itemIds) {
        if (!getItem(itemId)) return invalid(channel, `no such item: ${itemId}`);
    }

    return itemIds;
};

export const validateUpdateItem = (payload: unknown): { itemId: string; title?: string } => {
    const fields = record('updateItem', payload);
    const itemId = optionalString('updateItem', fields.itemId, 'itemId');

    if (!itemId) return invalid('updateItem', 'itemId is required');
    if (!getItem(itemId)) return invalid('updateItem', `no such item: ${itemId}`);
    if (!('title' in fields)) return invalid('updateItem', 'nothing to update');

    // `author` is deliberately not accepted here: it is the app's tag, not the user's field.
    return { itemId, title: blankToUndefined(optionalString('updateItem', fields.title, 'title')) };
};

/** Shape only — existence is on the device, and checking it there is the race we refuse. */
export const validateFilenames = (channel: string, payload: unknown): string[] => {
    const filenames = ids(channel, payload, 'filenames');

    for (const filename of filenames) {
        // Load-bearing: this string is about to be joined onto the mount path. (ADR-0029)
        if (filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
            return invalid(channel, `filename may not contain a path separator: ${filename}`);
        }
        if (filename === '.' || filename === '..' || filename.trim() !== filename) {
            return invalid(channel, `not a filename: ${filename}`);
        }
    }

    return filenames;
};

export const validateReorder = (payload: unknown): { type: ItemType; ordered: string[] } => {
    const fields = record('reorder', payload);

    if (!ITEM_TYPE.includes(fields.type as ItemType)) {
        return invalid('reorder', `type must be one of ${ITEM_TYPE.join(', ')}`);
    }

    const ordered = ids('reorder', payload, 'ordered');
    if (new Set(ordered).size !== ordered.length) {
        return invalid('reorder', 'ordered contains the same item twice');
    }

    for (const itemId of ordered) {
        const item = getItem(itemId);
        if (!item) return invalid('reorder', `no such item: ${itemId}`);
        // Media and audiobooks are separate index spaces; a mixed list is a bug. (ADR-0030)
        if (item.type !== fields.type) {
            return invalid('reorder', `${itemId} is not ${String(fields.type)}`);
        }
    }

    return { type: fields.type as ItemType, ordered };
};

export const validateOutputIds = (channel: string, payload: unknown): string[] => {
    const outputIds = ids(channel, payload, 'outputIds');

    for (const outputId of outputIds) {
        if (!getOutput(outputId)) return invalid(channel, `no such output: ${outputId}`);
    }

    return outputIds;
};

const NUMERIC_SETTINGS = [
    'bitrateMedia',
    'bitrateAudiobook',
    'splitEveryMin',
    'concurrency',
] as const;

const BOOLEAN_SETTINGS = ['renameMedia', 'renameAudiobook'] as const;

/** Normalised to strings, `null` clears. No upper bounds — a ceiling here is 0012's clamp. */
export const validateUpdateSettings = (
    payload: unknown,
): Partial<Record<SettingsType, string | null>> => {
    const fields = record('updateSettings', payload);
    const patch: Partial<Record<SettingsType, string | null>> = {};

    for (const key of NUMERIC_SETTINGS) {
        if (!(key in fields)) continue;

        const value = fields[key];
        if (value === null) {
            patch[key] = null;
            continue;
        }
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
            return invalid('updateSettings', `${key} must be a whole number of 1 or more`);
        }
        patch[key] = String(value);
    }

    // Stored as '1'/'0': the settings table is text, and a boolean has no other spelling. (ADR-0040)
    for (const key of BOOLEAN_SETTINGS) {
        if (!(key in fields)) continue;

        const value = fields[key];
        if (value === null) patch[key] = null;
        else if (typeof value === 'boolean') patch[key] = value ? '1' : '0';
        else return invalid('updateSettings', `${key} must be true, false, or null`);
    }

    if ('logLevel' in fields) {
        const value = fields.logLevel;
        if (value === null) patch.logLevel = null;
        else if (LOG_LEVELS.includes(value as LogLevel)) patch.logLevel = value as string;
        else return invalid('updateSettings', `logLevel must be one of ${LOG_LEVELS.join(', ')}`);
    }

    // The picker writes it (ADR-0016); accepting it here is only how the user clears it.
    if ('mountPath' in fields) {
        const value = fields.mountPath;
        if (value === null) patch.mountPath = null;
        else if (typeof value === 'string' && value.trim()) patch.mountPath = value;
        else return invalid('updateSettings', 'mountPath must be a non-empty path, or null');
    }

    if (Object.keys(patch).length === 0) return invalid('updateSettings', 'nothing to update');

    return patch;
};

export const validateSync = (
    payload: unknown,
): { mode: 'append-new' | 'reorder-all'; ordered: string[] } => {
    const fields = record('sync', payload);

    if (fields.mode !== 'append-new' && fields.mode !== 'reorder-all') {
        return invalid('sync', 'mode must be append-new or reorder-all');
    }

    const ordered = ids('sync', payload, 'ordered');
    for (const outputId of ordered) {
        if (!getOutput(outputId)) return invalid('sync', `no such output: ${outputId}`);
    }
    if (new Set(ordered).size !== ordered.length) {
        return invalid('sync', 'ordered contains the same output twice');
    }

    return { mode: fields.mode, ordered };
};
