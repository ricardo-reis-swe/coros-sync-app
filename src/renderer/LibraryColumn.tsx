import { Info, X } from 'lucide-react';
import { useState } from 'react';
import { EffectiveSettings, Item, ItemType, Output } from '../shared/data.types';
import Cell, { RowPlan } from './Cell';
import { ItemProgress } from './useMirror';

type LibraryColumnProps = {
    items: Item[];
    outputs: Output[];
    settings: EffectiveSettings | null;
    progress: Record<string, ItemProgress>;
    download: { done: number; total: number } | null;
    selected: Set<string>;
    libraryEmpty: boolean;
    onSelect: (itemIds: string[], checked: boolean) => void;
    onCancelDownloads: () => void;
    onProcess: () => void;
    onCancel: (itemIds: string[]) => void;
    onDelete: (itemIds: string[]) => void;
    onRename: (item: Item, title: string) => void;
};

/** Names the settings it will use, and that they are read now rather than at import. (ADR-0036) */
const processInfo = (settings: EffectiveSettings | null): string => {
    if (!settings) {
        return 'Media becomes one mp3. An audiobook is cut at its chapter marks, then any chapter longer than the split length becomes several parts — one mp3 each.';
    }

    return (
        `Media → one mp3 at ${settings.bitrateMedia} kbps. ` +
        `Audiobook → cut at its chapters, any chapter over ${settings.splitEveryMin} min split into parts, ` +
        `each an mp3 at ${settings.bitrateAudiobook} kbps. ` +
        'These are read when you press Process, so changing them in Settings first is what takes effect. ' +
        'What an item was made with is then shown beside its title.'
    );
};

const LibraryColumn = ({
    items,
    outputs,
    settings,
    progress,
    download,
    selected,
    libraryEmpty,
    onSelect,
    onCancelDownloads,
    onProcess,
    onCancel,
    onDelete,
    onRename,
}: LibraryColumnProps) => {
    // Not `selected.size`: this column holds every state, so a ticked `processed` row is not work.
    const processable = items.filter(
        (item) => item.state === 'imported' && selected.has(item.id),
    ).length;

    const plan = (item: Item): RowPlan => {
        if (item.state === 'processing') {
            const running = progress[item.id];
            return {
                spinning: true,
                // A bare spinner until the first delta, and for media, which is 1 → 1.
                counter: running && running.expected > 1 ? running : null,
                cancellable: true,
            };
        }

        return {
            deletable: true,
            // Only before the tags are written into the mp3s; after that `↺` is the way. (ARCHITECTURE §10)
            renamable: item.state === 'imported',
            // Exists only once processing has decided it, which is also when it stops being editable.
            badge: item.bitrate ? `${item.bitrate}k` : undefined,
        };
    };

    // A collapsed cell must give its space to its sibling, so the track lives here, not in the cell.
    const [hidden, setHidden] = useState<Set<ItemType>>(new Set());
    const toggleHidden = (type: ItemType) =>
        setHidden((current) => {
            const next = new Set(current);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
        });

    const track = (type: ItemType) => (hidden.has(type) ? 'auto' : 'minmax(0, 1fr)');

    const shared = { items, outputs, plan, selected, onSelect, onCancel, onDelete, onRename };

    return (
        <div
            className="column"
            // The strip is a row of its own, or the two cells lose their track. (ARCHITECTURE §10.4)
            style={{
                gridTemplateRows: `auto ${download ? 'auto ' : ''}${track('media')} ${track('audiobook')}`,
            }}
        >
            <header className="column-head">
                <h2 className="column-title">Library</h2>
                {/* The span carries the tooltip: a disabled button takes no hover, and that is exactly
                    when someone wants to know what the thing does. */}
                <span className="with-info" data-info={processInfo(settings)}>
                    {/* The count is the only thing that says what a collapsed cell still has ticked. */}
                    <button onClick={onProcess} disabled={processable === 0}>
                        {processable > 0 ? `Process (${processable})` : 'Process'}
                    </button>
                    <Info className="info-mark" size={13} />
                </span>
            </header>
            {/* No row to hang a counter on: the bytes precede the row, so the session is it. (ADR-0027) */}
            {download && (
                <div className="download-strip">
                    <span>
                        downloading {download.done}/{download.total}
                    </span>
                    <button className="row-icon" title="Stop downloading" onClick={onCancelDownloads}>
                        <X size={14} />
                    </button>
                </div>
            )}
            <Cell
                title="Media"
                type="media"
                empty={libraryEmpty ? 'Import media or an audiobook to start.' : undefined}
                hidden={hidden.has('media')}
                onToggleHidden={() => toggleHidden('media')}
                {...shared}
            />
            <Cell
                title="Audiobooks"
                type="audiobook"
                hidden={hidden.has('audiobook')}
                onToggleHidden={() => toggleHidden('audiobook')}
                {...shared}
            />
        </div>
    );
};

export default LibraryColumn;
