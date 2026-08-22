import { Info } from 'lucide-react';
import { useState } from 'react';
import { Item, ItemType, Output } from '../shared/data.types';
import Cell, { RowPlan } from './Cell';

type ProcessedColumnProps = {
    items: Item[];
    outputs: Output[];
    syncing: boolean;
    selected: Set<string>;
    /** The parts `[Stage]` would send, counted in App so the button and the payload are one list. (ADR-0054) */
    stageCount: number;
    onSelect: (itemIds: string[], checked: boolean) => void;
    onStage: () => void;
    onRevert: (itemIds: string[]) => void;
};

// Nothing distinguishes rows here — no grey, no number, no drag: all four said "staged". (ADR-0047)
const ProcessedColumn = ({
    items,
    outputs,
    syncing,
    selected,
    stageCount,
    onSelect,
    onStage,
    onRevert,
}: ProcessedColumnProps) => {

    // `expandable`: a part is tickable into this column's own set, never the watch's. (ADR-0051)
    const plan = (item: Item): RowPlan => ({
        expandable: true,
        revertable: !syncing,
        badge: item.bitrate ? `${item.bitrate}k` : undefined,
    });

    const [hidden, setHidden] = useState<Set<ItemType>>(new Set());
    const toggleHidden = (type: ItemType) =>
        setHidden((current) => {
            const next = new Set(current);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
        });

    const track = (type: ItemType) => (hidden.has(type) ? 'auto' : 'minmax(0, 1fr)');

    const shared = {
        items,
        outputs,
        plan,
        selected,
        onSelect,
        onCancel: () => undefined,
        onRevert,
    };

    return (
        <div
            className="column"
            style={{ gridTemplateRows: `auto ${track('media')} ${track('audiobook')}` }}
        >
            <header className="column-head">
                <h2 className="column-title">Processed</h2>
                <span
                    className="with-info"
                    data-info="Moves the ticked rows onto the watch's send list, in column 3 — and ticking only some chapters puts only those on the list. Nothing is transcoded and nothing is copied — it is the point where you say an item may go, which is what gives it a playback position. Taking it back off the list keeps the mp3s."
                >
                    <button onClick={onStage} disabled={stageCount === 0 || syncing}>
                        {stageCount > 0 ? `Stage (${stageCount})` : 'Stage'}
                    </button>
                    <Info className="info-mark" size={13} />
                </span>
            </header>
            <Cell
                title="Media"
                type="media"
                empty="Nothing processed yet."
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

export default ProcessedColumn;
