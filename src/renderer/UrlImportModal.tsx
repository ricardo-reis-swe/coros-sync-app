import { useEffect, useState } from 'react';

type UrlImportModalProps = {
    multi: boolean;
    onClose: () => void;
    onImport: (urls: string[]) => void;
};

/** Mirrors main's check so the button can be dead; main is still the one that decides. (ADR-0027) */
const usable = (raw: string): boolean => {
    const parsed = URL.parse(raw);
    return parsed !== null && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
};

const linesOf = (draft: string): string[] =>
    draft
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');

const UrlImportModal = ({ multi, onClose, onImport }: UrlImportModalProps) => {
    const [draft, setDraft] = useState('');

    const urls = linesOf(draft);
    const bad = urls.filter((url) => !usable(url));
    const ready = urls.length > 0 && bad.length === 0;

    const submit = () => {
        if (!ready) return;
        onImport(urls);
        onClose();
    };

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
                <h2>{multi ? 'Import URLs' : 'Import URL'}</h2>

                {multi ? (
                    <textarea
                        className="url-input"
                        rows={8}
                        autoFocus
                        placeholder={'One URL per line'}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                    />
                ) : (
                    <input
                        className="url-input"
                        autoFocus
                        placeholder="https://…"
                        value={draft}
                        // Enter submits only here: in a textarea it is how you reach the next line.
                        onKeyDown={(event) => event.key === 'Enter' && submit()}
                        onChange={(event) => setDraft(event.target.value)}
                    />
                )}

                {/* Named, not just refused: "Import" going dead with no reason is the worse failure. */}
                {bad.length > 0 && (
                    <p className="url-bad">
                        Not an http or https link: {bad.slice(0, 3).join(', ')}
                        {bad.length > 3 && ` and ${bad.length - 3} more`}
                    </p>
                )}

                <footer className="modal-foot">
                    <button onClick={onClose}>Cancel</button>
                    <button disabled={!ready} onClick={submit}>
                        {urls.length > 1 ? `Import (${urls.length})` : 'Import'}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default UrlImportModal;
