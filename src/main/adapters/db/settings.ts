import os from 'node:os';
import { EffectiveSettings, LOG_LEVELS, LogLevel, SettingsType } from '../../../shared/data.types';
import { deleteSetting, getSetting, setSetting } from './db.queries';

/** The one place code defaults live; six inline `??`s is how two of them drift. (ADR-0012) */

// ADR-0026. (ADR-0012's illustrative 192 / 15 are superseded; nothing else in it is.)
export const DEFAULTS = {
    bitrateMedia: 128,
    bitrateAudiobook: 64,
    splitEveryMin: 10,
    logLevel: 'info' as LogLevel,
    // On for audiobooks is today's behaviour; media's composed name is a no-op anyway. (ADR-0040)
    renameMedia: false,
    renameAudiobook: true,
} as const;

const number = (key: SettingsType, fallback: number): number => {
    const raw = getSetting(key);
    if (raw === undefined) return fallback;

    const parsed = Number(raw);
    // A corrupt row may stop the app being configured; never stop it working. (ADR-0012)
    return Number.isFinite(parsed) ? parsed : fallback;
};

const boolean = (key: SettingsType, fallback: boolean): boolean => {
    const raw = getSetting(key);
    // Anything else is a corrupt row, and a corrupt row never stops the app working. (ADR-0012)
    return raw === '1' ? true : raw === '0' ? false : fallback;
};

/* ---------- live (read at act time) ---------- */

/** Which of an output's two names sync writes; read once per session, never per file. (ADR-0040) */
export const renameSetting = (type: 'media' | 'audiobook'): boolean =>
    type === 'media'
        ? boolean('renameMedia', DEFAULTS.renameMedia)
        : boolean('renameAudiobook', DEFAULTS.renameAudiobook);

/** Read when processing starts, not at import — and then recorded on the row. (ADR-0036) */
export const bitrateSetting = (type: 'media' | 'audiobook'): number =>
    type === 'media'
        ? number('bitrateMedia', DEFAULTS.bitrateMedia)
        : number('bitrateAudiobook', DEFAULTS.bitrateAudiobook);

export const splitEveryMinSetting = (): number =>
    number('splitEveryMin', DEFAULTS.splitEveryMin);

/** `N = max(1, setting ?? cores - 1)` — verbatim, no upper clamp, floor of 1. (ADR-0012) */
export const concurrency = (): number =>
    Math.max(1, Math.floor(number('concurrency', os.cpus().length - 1)));

export const logLevel = (): LogLevel => {
    const raw = getSetting('logLevel');
    return LOG_LEVELS.includes(raw as LogLevel) ? (raw as LogLevel) : DEFAULTS.logLevel;
};

export const mountPath = (): string | null => getSetting('mountPath') ?? null;

/** Null means the bundled copy; read per fetch, never cached. (ADR-0055) */
export const ytdlpPath = (): string | null => getSetting('ytdlpPath') ?? null;

/* ---------- the snapshot's view ---------- */

/** Defaults already applied: the renderer gets resolved numbers and never learns one. (ADR-0024) */
export const effectiveSettings = (): EffectiveSettings => ({
    bitrateMedia: bitrateSetting('media'),
    bitrateAudiobook: bitrateSetting('audiobook'),
    splitEveryMin: splitEveryMinSetting(),
    concurrency: concurrency(),
    logLevel: logLevel(),
    mountPath: mountPath(),
    renameMedia: renameSetting('media'),
    renameAudiobook: renameSetting('audiobook'),
    ytdlpPath: ytdlpPath(),
});

/** `null` clears the key — the code default takes over again. An absent key is untouched. */
export const applySettings = (patch: Partial<Record<SettingsType, string | null>>): void => {
    for (const [key, value] of Object.entries(patch) as [SettingsType, string | null][]) {
        if (value === null) deleteSetting(key);
        else setSetting(key, value);
    }
};
