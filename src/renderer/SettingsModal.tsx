import { useEffect, useState } from 'react';
import { EffectiveSettings, LOG_LEVELS, LogLevel } from '../shared/data.types';
import { IpcUpdateSettingsPayload } from '../shared/ipc.types';

type SettingsModalProps = {
    settings: EffectiveSettings;
    onClose: () => void;
    onPatch: (patch: IpcUpdateSettingsPayload) => void;
    onChooseFolder: () => void;
};

type NumberKey = 'bitrateMedia' | 'bitrateAudiobook' | 'splitEveryMin' | 'concurrency';

// `null` is a staged Reset: the key is cleared on Save and the code default takes over.
type BooleanKey = 'renameMedia' | 'renameAudiobook';

type Draft = Record<NumberKey, string | null> &
    Record<BooleanKey, boolean> & { logLevel: LogLevel | null; ytdlpPath: string };

const draftFrom = (settings: EffectiveSettings): Draft => ({
    bitrateMedia: String(settings.bitrateMedia),
    bitrateAudiobook: String(settings.bitrateAudiobook),
    splitEveryMin: String(settings.splitEveryMin),
    concurrency: String(settings.concurrency),
    logLevel: settings.logLevel,
    renameMedia: settings.renameMedia,
    renameAudiobook: settings.renameAudiobook,
    // '' is both "unset" and "clear it": a path setting has no third state. (ADR-0055)
    ytdlpPath: settings.ytdlpPath ?? '',
});

const parse = (raw: string): number | null => {
    const value = Number(raw);
    return Number.isFinite(value) && value >= 1 ? Math.round(value) : null;
};

const NUMBER_KEYS: NumberKey[] = ['bitrateMedia', 'bitrateAudiobook', 'splitEveryMin', 'concurrency'];

const BOOLEAN_KEYS: BooleanKey[] = ['renameMedia', 'renameAudiobook'];

// Absent key = leave alone, `null` = clear, number = set; only what actually moved is sent.
const patchFrom = (draft: Draft, settings: EffectiveSettings): IpcUpdateSettingsPayload => {
    const patch: IpcUpdateSettingsPayload = {};

    for (const key of NUMBER_KEYS) {
        const raw = draft[key];
        if (raw === null) patch[key] = null;
        else {
            const value = parse(raw);
            if (value !== null && value !== settings[key]) patch[key] = value;
        }
    }

    if (draft.logLevel === null) patch.logLevel = null;
    else if (draft.logLevel !== settings.logLevel) patch.logLevel = draft.logLevel;

    // No Reset for these two: a checkbox already shows its whole state. (ADR-0040)
    for (const key of BOOLEAN_KEYS) {
        if (draft[key] !== settings[key]) patch[key] = draft[key];
    }

    const ytdlpPath = draft.ytdlpPath.trim();
    if (ytdlpPath !== (settings.ytdlpPath ?? '')) patch.ytdlpPath = ytdlpPath || null;

    return patch;
};

// Values arrive effective, so the renderer cannot tell a user's number from a default (ADR-0024).
const NumberField = ({
    label,
    unit,
    draft,
    onChange,
}: {
    label: string;
    unit: string;
    draft: string | null;
    onChange: (next: string | null) => void;
}) => (
    <label className="field">
        <span className="field-label">{label}</span>
        <input
            value={draft ?? ''}
            placeholder={draft === null ? 'default' : undefined}
            inputMode="numeric"
            aria-invalid={draft !== null && parse(draft) === null}
            onChange={(event) => onChange(event.target.value)}
        />
        <span className="field-unit">{unit}</span>
        <button disabled={draft === null} onClick={() => onChange(null)}>
            Reset
        </button>
    </label>
);

// The draft is seeded once, on open: a snapshot arriving mid-edit must not overwrite typing.
const SettingsModal = ({ settings, onClose, onPatch, onChooseFolder }: SettingsModalProps) => {
    const [draft, setDraft] = useState<Draft>(() => draftFrom(settings));

    const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

    const invalid = NUMBER_KEYS.some((key) => draft[key] !== null && parse(draft[key] as string) === null);
    const patch = patchFrom(draft, settings);
    const dirty = Object.keys(patch).length > 0;

    const close = () => {
        if (dirty && !confirm('Discard the unsaved settings changes?')) return;
        onClose();
    };

    const save = () => {
        onPatch(patch);
        onClose();
    };

    // No dependency array: `close` reads the draft, and a stale handler would discard the wrong edit.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };

        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    return (
        <div className="modal-backdrop" onClick={close}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
                <h2>Settings</h2>

                <h3>Seed — applies to new imports only</h3>
                <NumberField
                    label="Media bitrate"
                    unit="kbps"
                    draft={draft.bitrateMedia}
                    onChange={(bitrateMedia) => set({ bitrateMedia })}
                />
                <NumberField
                    label="Audiobook bitrate"
                    unit="kbps"
                    draft={draft.bitrateAudiobook}
                    onChange={(bitrateAudiobook) => set({ bitrateAudiobook })}
                />
                <NumberField
                    label="Split every"
                    unit="min"
                    draft={draft.splitEveryMin}
                    onChange={(splitEveryMin) => set({ splitEveryMin })}
                />

                <h3>Live — applies immediately</h3>
                <NumberField
                    label="Concurrency"
                    unit="children"
                    draft={draft.concurrency}
                    onChange={(concurrency) => set({ concurrency })}
                />
                <label className="field">
                    <span className="field-label">Log level</span>
                    <select
                        value={draft.logLevel ?? ''}
                        onChange={(event) => set({ logLevel: event.target.value as LogLevel })}
                    >
                        {draft.logLevel === null && <option value="">default</option>}
                        {LOG_LEVELS.map((level) => (
                            <option key={level} value={level}>
                                {level}
                            </option>
                        ))}
                    </select>
                    <button disabled={draft.logLevel === null} onClick={() => set({ logLevel: null })}>
                        Reset
                    </button>
                </label>
                {/* Takes effect on the next Reorder all; files already on the watch keep their name. (ADR-0040) */}
                <label className="field">
                    <span className="field-label">Rename audiobooks on the watch</span>
                    <input
                        type="checkbox"
                        checked={draft.renameAudiobook}
                        onChange={(event) => set({ renameAudiobook: event.target.checked })}
                    />
                    <span className="field-unit">title, chapter and part</span>
                </label>
                <label className="field">
                    <span className="field-label">Rename media on the watch</span>
                    <input
                        type="checkbox"
                        checked={draft.renameMedia}
                        onChange={(event) => set({ renameMedia: event.target.checked })}
                    />
                    <span className="field-unit">artist prefix</span>
                </label>
                {/* Typed, not picked: a native dialog for the one field almost nobody sets. (ADR-0055) */}
                <label className="field">
                    <span className="field-label">yt-dlp binary</span>
                    <input
                        className="field-path"
                        placeholder="the bundled copy"
                        value={draft.ytdlpPath ?? ''}
                        onChange={(event) => set({ ytdlpPath: event.target.value })}
                    />
                    <span className="field-unit">blank uses the one we shipped</span>
                    <button disabled={!draft.ytdlpPath} onClick={() => set({ ytdlpPath: '' })}>
                        Reset
                    </button>
                </label>
                {/* The folder is picked in a native dialog and rescanned there — it is not part of the draft. */}
                <label className="field">
                    <span className="field-label">Watch Music folder</span>
                    <code className="field-path">{settings.mountPath ?? 'none chosen'}</code>
                    <button
                        onClick={onChooseFolder}
                        title="Pick the Music folder inside the watch’s USB volume — not the volume itself"
                    >
                        Choose…
                    </button>
                </label>

                <footer className="modal-foot">
                    <button onClick={close}>Cancel</button>
                    <button disabled={!dirty || invalid} onClick={save}>
                        Save
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default SettingsModal;
