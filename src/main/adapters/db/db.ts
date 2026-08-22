import { app } from 'electron';
import { rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

type Table = {
    name: string;
    columns: Record<string, string>;
};

const buildCreateTable = (table: Table): string => {
    const columns = Object.entries(table.columns)
        .map(([name, definition]) => `  ${name} ${definition}`)
        .join(',\n');

    return `CREATE TABLE IF NOT EXISTS ${table.name} (\n${columns}\n)`;
};

const dbPath = path.join(app.getPath('userData'), 'app.db');
const db = new Database(dbPath);

// must be set outside a transaction to take effect
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const itemsTable: Table = {
    name: 'items',
    columns: {
        id: 'TEXT PRIMARY KEY NOT NULL',
        state: `TEXT NOT NULL CHECK (state IN ('imported', 'processing', 'processed', 'ready'))`,
        groupId: 'TEXT NOT NULL',
        groupName: 'TEXT NOT NULL',
        sourcePath: 'TEXT NOT NULL',
        type: `TEXT NOT NULL CHECK (type IN ('media', 'audiobook'))`,
        title: 'TEXT',
        author: 'TEXT',
        bitrate: 'INTEGER', // null until processing decides it (ADR-0036)
        splitEveryMin: 'INTEGER',
        orderIndex: 'INTEGER NOT NULL',
    },
};

const outputsTable: Table = {
    name: 'outputs',
    columns: {
        id: 'TEXT PRIMARY KEY',
        itemId: 'TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE',
        filePath: 'TEXT NOT NULL',
        chapterIndex: 'INTEGER',
        chapterTitle: 'TEXT',
        partIndex: 'INTEGER DEFAULT 1',
        deviceFilename: 'TEXT NOT NULL UNIQUE',
        deviceFilenamePlain: 'TEXT NOT NULL UNIQUE', // the sibling name (ADR-0040)
        onWatch: 'INTEGER NOT NULL DEFAULT 0 CHECK (onWatch IN (0, 1))',
    },
};

const settingsTable: Table = {
    name: 'settings',
    columns: {
        key: 'TEXT PRIMARY KEY',
        value: 'TEXT',
    },
};

// order matters: outputs references items, so items must exist first
const tables = [itemsTable, outputsTable, settingsTable];

/** Bump on any column change — and add the matching step to `MIGRATIONS` in the same commit. */
const SCHEMA_VERSION = 4;

// not run at import: a fresh database must be distinguishable from a pre-stamp one. (ADR-0037)
const createSchema = db.transaction(() => {
    for (const table of tables) {
        db.exec(buildCreateTable(table));
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
});

type Migration = {
    to: number;
    up: (db: Database.Database) => void;
};

/** Floored at v2: nothing below it has a step, so nothing below it opens. (ADR-0037) */
const MIGRATIONS: Migration[] = [
    {
        to: 3,
        // A rebuild, not ADD COLUMN: SQLite cannot add a NOT NULL UNIQUE column. (ADR-0040)
        up: (db) => {
            db.exec(buildCreateTable({ ...outputsTable, name: 'outputs_v3' }));
            // Backfilled equal, because a row born before v3 has no plain name and cannot gain one. (ADR-0040)
            db.exec(`
                INSERT INTO outputs_v3 (
                    id, itemId, filePath, chapterIndex, chapterTitle,
                    partIndex, deviceFilename, deviceFilenamePlain, onWatch
                )
                SELECT
                    id, itemId, filePath, chapterIndex, chapterTitle,
                    partIndex, deviceFilename, deviceFilename, onWatch
                FROM outputs
            `);
            db.exec(`DROP TABLE outputs`);
            db.exec(`ALTER TABLE outputs_v3 RENAME TO outputs`);
        },
    },
    {
        to: 4,
        // Rebuilds the PARENT table — ADR-0037's cascade hazard, and why the ladder holds FK off. (ADR-0041)
        up: (db) => {
            db.exec(buildCreateTable({ ...itemsTable, name: 'items_v4' }));
            db.exec(`
                INSERT INTO items_v4 (
                    id, state, groupId, groupName, sourcePath,
                    type, title, author, bitrate, splitEveryMin, orderIndex
                )
                SELECT
                    id, state, groupId, groupName, sourcePath,
                    CASE type WHEN 'music' THEN 'media' ELSE type END,
                    title, author, bitrate, splitEveryMin, orderIndex
                FROM items
            `);
            db.exec(`DROP TABLE items`);
            db.exec(`ALTER TABLE items_v4 RENAME TO items`);

            // Migrated, not left to fall back: a configured bitrate survives the rename. (ADR-0041)
            db.exec(`UPDATE settings SET key = 'bitrateMedia' WHERE key = 'bitrateMusic'`);
            db.exec(`UPDATE settings SET key = 'renameMedia' WHERE key = 'renameMusic'`);
        },
    },
];

const isCreated = (): boolean =>
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items'`).get() !==
    undefined;

// the steps from `found` up to the stamp, or null when they do not form an unbroken chain
const ladderFrom = (found: number): Migration[] | null => {
    const steps = MIGRATIONS.filter((m) => m.to > found).sort((a, b) => a.to - b.to);
    const unbroken = steps.every((m, i) => m.to === found + i + 1);

    return unbroken && steps[steps.length - 1]?.to === SCHEMA_VERSION ? steps : null;
};

/** `VACUUM INTO`, not a file copy: in WAL mode the committed truth is split across two files. (ADR-0040) */
const backup = (found: number): void => {
    const target = `${dbPath}.v${found}.bak`;
    // VACUUM INTO refuses an existing file, so a retried migration overwrites its own last attempt.
    rmSync(target, { force: true });
    db.prepare(`VACUUM INTO ?`).run(target);
};

const runLadder = (steps: Migration[]): void => {
    // a step that rebuilds `items` would cascade-delete outputs; the pragma cannot move inside a transaction
    db.pragma('foreign_keys = OFF');
    try {
        db.transaction(() => {
            for (const step of steps) {
                step.up(db);
                db.pragma(`user_version = ${step.to}`);
            }

            const violations = db.pragma('foreign_key_check') as unknown[];
            if (violations.length > 0) {
                throw new Error(`${violations.length} foreign key violation(s) after migrating`);
            }
        })();
    } finally {
        db.pragma('foreign_keys = ON');
    }
};

/** A function main calls, not a module-scope throw: null when usable, else the user's sentence. */
export const openSchema = (): string | null => {
    if (!isCreated()) {
        createSchema();
        return null;
    }

    const [{ user_version: found }] = db.pragma('user_version') as { user_version: number }[];

    // 0 means "older than this stamp" — adopted, since only throwaway dev DBs are in that state.
    if (found === 0) {
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
        return null;
    }
    if (found === SCHEMA_VERSION) return null;

    const preamble =
        `This library is v${found}; this build expects v${SCHEMA_VERSION}.\n\n` +
        `Nothing has been changed. `;

    if (found > SCHEMA_VERSION) {
        return `${preamble}It was written by a newer version of the app — install that one.`;
    }

    const steps = ladderFrom(found);
    if (!steps) {
        return `${preamble}There is no upgrade path from v${found}. Delete app.db to start fresh.`;
    }

    try {
        // One transaction makes a *failed* migration safe; only a copy survives a successful wrong one. (ADR-0040)
        backup(found);
        runLadder(steps);
    } catch (err) {
        // the message reaches the user, not the log: nothing is being forgotten and the app is quitting (ADR-0013)
        const reason = err instanceof Error ? err.message : String(err);
        return `${preamble}Upgrading it failed and was rolled back:\n\n${reason}`;
    }

    return null;
};

export default db;
