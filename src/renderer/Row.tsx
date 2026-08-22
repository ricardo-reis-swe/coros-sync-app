import {
    Check,
    ChevronDown,
    ChevronRight,
    CornerUpLeft,
    GripVertical,
    ListPlus,
    LoaderCircle,
    RotateCcw,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type Counter = { completed: number; expected: number };

export type RowProps = {
    label: string;
    /** Sits after the title: what this item is, in a few characters. */
    badge?: string;
    depth?: number;
    grey?: boolean;
    number?: number;
    expanded?: boolean;
    onToggle?: () => void;
    checked?: boolean;
    indeterminate?: boolean;
    onCheck?: (checked: boolean) => void;
    /** The whole row becomes the checkbox's hit area — for rows inside something the user opened. */
    clickToCheck?: boolean;
    // A bare spinner when the counter is absent: media is 1 → 1 and has nothing to count.
    spinning?: boolean;
    counter?: Counter | null;
    tick?: boolean;
    onCancel?: () => void;
    onCatchUp?: () => void;
    /** Out of column 3 and back to `processed`. Keeps the mp3s — that is the whole difference from `↺`. */
    onUnstage?: () => void;
    onRevert?: () => void;
    onDelete?: () => void;
    onRename?: (title: string) => void;
    draggable?: boolean;
    onDragStart?: () => void;
    onDrop?: () => void;
};

const Row = ({
    label,
    badge,
    depth = 0,
    grey,
    number,
    expanded,
    onToggle,
    checked,
    indeterminate,
    onCheck,
    clickToCheck,
    spinning,
    counter,
    tick,
    onCancel,
    onCatchUp,
    onUnstage,
    onRevert,
    onDelete,
    onRename,
    draggable,
    onDragStart,
    onDrop,
}: RowProps) => {
    const box = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState(false);

    const commit = (next: string) => {
        setEditing(false);
        if (onRename && next.trim() && next !== label) onRename(next.trim());
    };

    // The row is only a hit area where a control is not: the arrow, the boxes and the icons keep their clicks.
    const rowClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!onCheck || spinning || tick) return;
        const target = event.target as HTMLElement;
        // The label is excluded wherever it is a rename target — that gesture is a double-click on it.
        if (target.closest('button, input') || (onRename && target.closest('.row-label'))) return;

        onCheck(!checked);
    };

    // Indeterminate is a DOM property, not an attribute: React cannot set it in JSX.
    useEffect(() => {
        if (box.current) box.current.indeterminate = Boolean(indeterminate);
    }, [indeterminate]);

    return (
        <div
            className={`row${grey ? ' row-grey' : ''}${clickToCheck && onCheck ? ' row-pick' : ''}`}
            style={{ paddingLeft: `${depth * 1.1}rem` }}
            onClick={clickToCheck ? rowClick : undefined}
            draggable={draggable}
            onDragStart={onDragStart}
            onDragOver={onDrop ? (event) => event.preventDefault() : undefined}
            onDrop={onDrop}
        >
            {number != null && <span className="row-number">{number}</span>}
            {draggable && <GripVertical className="row-handle" size={14} />}

            {onToggle ? (
                <button className="row-arrow" onClick={onToggle} aria-label="Expand">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
            ) : (
                // The slot is held at every depth, or a child without an arrow lands left of its parent's title.
                number == null && <span className="row-arrow" />
            )}

            {editing ? (
                <input
                    className="row-label"
                    autoFocus
                    defaultValue={label}
                    onBlur={(event) => commit(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') commit(event.currentTarget.value);
                        if (event.key === 'Escape') setEditing(false);
                    }}
                />
            ) : (
                <span
                    className="row-label"
                    onDoubleClick={onRename ? () => setEditing(true) : undefined}
                    title={label}
                >
                    {label}
                </span>
            )}

            {badge && <span className="row-badge">{badge}</span>}

            <span className="row-tail">
                {counter && (
                    <span className="row-counter">
                        {counter.completed}/{counter.expected}
                    </span>
                )}
                {spinning && <LoaderCircle className="row-spinner" size={14} />}
                {tick && <Check className="row-tick" size={14} />}
                {!spinning && !tick && onCheck && (
                    <input
                        ref={box}
                        type="checkbox"
                        checked={Boolean(checked)}
                        onChange={(event) => onCheck(event.target.checked)}
                    />
                )}
                {onCancel && (
                    <button className="row-icon" onClick={onCancel} title="Cancel">
                        <X size={14} />
                    </button>
                )}
                {onCatchUp && (
                    <button
                        className="row-icon"
                        onClick={onCatchUp}
                        title="Tick the parts after the last one on the watch"
                    >
                        <ListPlus size={14} />
                    </button>
                )}
                {onUnstage && (
                    <button
                        className="row-icon"
                        onClick={onUnstage}
                        title="Take off the send list — keeps the mp3s"
                    >
                        <CornerUpLeft size={14} />
                    </button>
                )}
                {onRevert && (
                    <button
                        className="row-icon"
                        onClick={onRevert}
                        title="Send back to the library — deletes the mp3s"
                    >
                        <RotateCcw size={14} />
                    </button>
                )}
                {onDelete && (
                    <button className="row-icon" onClick={onDelete} title="Delete">
                        <Trash2 size={14} />
                    </button>
                )}
            </span>
        </div>
    );
};

export default Row;
