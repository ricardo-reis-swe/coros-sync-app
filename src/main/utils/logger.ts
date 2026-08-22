import { app } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { LOG_LEVELS, LogLevel } from '../../shared/data.types';
import { logLevel } from '../adapters/db/settings';

/** The durable trace of what the model forgets: four sites, and it never crosses IPC. (ADR-0013) */

// One live file, three behind it: enough to survive a session, small enough to paste.
const MAX_BYTES = 1024 * 1024;
const RETAINED = 3;
const TAIL_BYTES = 64 * 1024;

export const logsDir = (): string => path.join(app.getPath('userData'), 'logs');

const logFile = (): string => path.join(logsDir(), 'app.log');

/** `logLevel` is a **live** setting: read at act time, copied nowhere. (ADR-0012) */
const enabled = (level: LogLevel): boolean =>
    LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(logLevel());

const rotate = (file: string): void => {
    try {
        if (statSync(file).size < MAX_BYTES) return;
    } catch {
        return; // nothing written yet
    }

    rmSync(`${file}.${RETAINED}`, { force: true });
    for (let i = RETAINED - 1; i >= 1; i--) {
        try {
            renameSync(`${file}.${i}`, `${file}.${i + 1}`);
        } catch {
            // that generation does not exist yet
        }
    }

    try {
        renameSync(file, `${file}.1`);
    } catch {
        // raced with another write; the next line lands in whichever file now exists
    }
};

/** Synchronous on purpose: a buffered write is the one that does not survive the crash it records. */
const write = (level: LogLevel, message: string): void => {
    if (!enabled(level)) return;

    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}\n`;

    try {
        mkdirSync(logsDir(), { recursive: true });
        rotate(logFile());
        appendFileSync(logFile(), line);
    } catch {
        // A log that cannot be written must never take the app down with it.
    }
};

export const log = {
    error: (message: string) => write('error', message),
    warn: (message: string) => write('warn', message),
    info: (message: string) => write('info', message),
    debug: (message: string) => write('debug', message),
};

/** For `copyLogs`: main reads it, the clipboard carries it, the renderer never sees it. (ADR-0013) */
export const readLogTail = (): string => {
    try {
        return readFileSync(logFile(), 'utf8').slice(-TAIL_BYTES);
    } catch {
        return '';
    }
};
