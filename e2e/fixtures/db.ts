import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { Item, Output } from '../../src/shared/data.types';

// Read-only against the LIVE WAL file, for what the screen cannot say: a row that should NOT exist.
const read = <T>(userData: string, sql: string): T[] => {
    const db = new DatabaseSync(path.join(userData, 'app.db'), { readOnly: true });
    try {
        return db.prepare(sql).all() as T[];
    } finally {
        db.close();
    }
};

export const items = (userData: string): Item[] => read<Item>(userData, 'SELECT * FROM items');

type OutputRow = Omit<Output, 'onWatch'> & { onWatch: number };

export const outputs = (userData: string): Output[] =>
    read<OutputRow>(userData, 'SELECT * FROM outputs').map((row) => ({
        ...row,
        onWatch: row.onWatch === 1,
    }));
