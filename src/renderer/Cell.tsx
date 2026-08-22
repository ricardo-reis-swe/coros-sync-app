import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Item, ItemType, Output } from '../shared/data.types';
import Row, { Counter } from './Row';
import {
    Chapter,
    chaptersOf,
    Group,
    groupProgress,
    groupsOf,
    isFolder,
    outputsOf,
    partLabel,
    partOnlyLabel,
    partsAfterWatched,
    titleOf,
} from './derive';

export type RowPlan = {
    counter?: Counter | null;
    spinning?: boolean;
    tick?: boolean;
    grey?: boolean;
    number?: number;
    draggable?: boolean;
    cancellable?: boolean;
    /** Column 3's staged rows only: the way back to column 2, without unmaking anything. (ADR-0047) */
    unstageable?: boolean;
    revertable?: boolean;
    /** A short fact shown after the title — bitrate, format. */
    badge?: string;
    /** Per row, not per column: only an `imported` row may be renamed. (ARCHITECTURE §10) */
    renamable?: boolean;
    deletable?: boolean;
    // Only a `ready` audiobook shows its parts; before that there are no outputs to show.
    expandable?: boolean;
};

type CellProps = {
    /** Absent renders no heading: column 3's staged region is one flat list under the divider. */
    title?: string;
    /** An array keeps the type *blocks* without drawing a cell per type — media first, then books. */
    type: ItemType | ItemType[];
    items: Item[];
    outputs: Output[];
    /** The item's *whole* output list, when `outputs` is a subset of it. Only `⤓` needs it. (ADR-0047) */
    allOutputs?: Output[];
    empty?: string;
    /** Owned by the column, not the cell: its row track has to shrink with it. */
    hidden?: boolean;
    onToggleHidden?: () => void;
    plan: (item: Item) => RowPlan;
    /** Both absent means no picking in this column: no box at any level, no row hit area, no `⤓`. (ADR-0053) */
    selected?: Set<string>;
    onSelect?: (itemIds: string[], checked: boolean) => void;
    onCancel: (itemIds: string[]) => void;
    onUnstage?: (itemIds: string[]) => void;
    /** `⇤` below the item row: output ids, because a chapter and a part are not `state`'s unit. (ADR-0054) */
    onDiscard?: (outputIds: string[]) => void;
    onRevert?: (itemIds: string[]) => void;
    /** Column 1's only: an item leaves the library from the library. (ARCHITECTURE §10) */
    onDelete?: (itemIds: string[]) => void;
    onRename?: (item: Item, title: string) => void;
    onDropOn?: (dragged: string, target: string) => void;
};

const Cell = ({
    title,
    type,
    items,
    outputs,
    allOutputs,
    empty,
    hidden,
    onToggleHidden,
    plan,
    selected = new Set<string>(),
    onSelect,
    onCancel,
    onUnstage,
    onDiscard,
    onRevert,
    onDelete,
    onRename,
    onDropOn,
}: CellProps) => {
    // Tracks what is OPEN, so the default is closed — a folder import lands as one row, not twenty.
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
    const [openItems, setOpenItems] = useState<Set<string>>(new Set());
    const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
    const [dragged, setDragged] = useState<string | null>(null);

    // Concatenated per type, never sorted across them: the two index spaces are independent. (ADR-0030)
    const types = Array.isArray(type) ? type : [type];
    const groups = types.flatMap((each) => groupsOf(items, each));
    // Both cells are handed the whole column, so the heading has to count its own type, not the prop.
    const mine = items.filter((item) => types.includes(item.type));

    const toggle = (set: Set<string>, key: string, apply: (next: Set<string>) => void) => {
        const next = new Set(set);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        apply(next);
    };

    /** One set holds both: Sync reads the output ids, Stage and Delete read the item ids. */
    const idsFor = (item: Item): string[] => [
        item.id,
        ...outputsOf(outputs, item.id).map((output) => output.id),
    ];

    /** Gated on `expandable`: a processing item's outputs half-exist, and the box must not follow them. */
    const partsOf = (item: Item, shape: RowPlan): Output[] =>
        shape.expandable ? outputsOf(outputs, item.id) : [];

    const isTicked = (item: Item, shape: RowPlan): boolean => {
        const parts = partsOf(item, shape);
        return parts.length > 0
            ? parts.every((output) => selected.has(output.id))
            : selected.has(item.id);
    };

    // Only while collapsed: open rows show their own ticks, and `plan` runs per item here.
    const ticked = hidden ? mine.filter((item) => isTicked(item, plan(item))).length : 0;

    const itemRow = (item: Item, depth: number, badgedByParent = false) => {
        const shape = plan(item);
        const parts = partsOf(item, shape);
        const chapters = chaptersOf(parts);
        const open = openItems.has(item.id);

        // A book only, and read from the full list rather than the rendered subset.
        const whole = allOutputs ? outputsOf(allOutputs, item.id) : parts;
        const next = whole.length > 1 ? partsAfterWatched(whole) : [];

        // Derived from the parts once there are any, so unticking one shows as a partial box.
        const ticked = parts.filter((output) => selected.has(output.id)).length;

        // Closed, this is the only place a row says how many files it feeds `[Sync]`, which counts files.
        const resting =
            !open && parts.length > 1
                ? {
                      completed: parts.filter((output) => output.onWatch).length,
                      expected: parts.length,
                  }
                : null;

        return (
            <div key={item.id}>
                <Row
                    label={titleOf(item)}
                    badge={badgedByParent ? undefined : shape.badge}
                    depth={depth}
                    grey={shape.grey}
                    number={shape.number}
                    counter={shape.counter ?? resting}
                    spinning={shape.spinning}
                    tick={shape.tick}
                    expanded={parts.length > 1 ? open : undefined}
                    onToggle={
                        parts.length > 1
                            ? () => toggle(openItems, item.id, setOpenItems)
                            : undefined
                    }
                    checked={isTicked(item, shape)}
                    indeterminate={ticked > 0 && ticked < parts.length}
                    onCheck={onSelect ? (next) => onSelect(idsFor(item), next) : undefined}
                    // Opened, or a child of something opened: rows the user is picking through. (ARCHITECTURE §10)
                    clickToCheck={Boolean(onSelect) && (open || depth > 0)}
                    onCancel={shape.cancellable ? () => onCancel([item.id]) : undefined}
                    // Only where there is something to carry on to, and only on a row being sent.
                    onCatchUp={
                        onSelect && !shape.spinning && next.length > 0
                            ? () => onSelect(next.map((output) => output.id), true)
                            : undefined
                    }
                    onUnstage={
                        shape.unstageable && onUnstage ? () => onUnstage([item.id]) : undefined
                    }
                    onRevert={
                        shape.revertable && onRevert ? () => onRevert([item.id]) : undefined
                    }
                    onDelete={shape.deletable && onDelete ? () => onDelete([item.id]) : undefined}
                    onRename={shape.renamable && onRename ? (title) => onRename(item, title) : undefined}
                    draggable={shape.draggable}
                    onDragStart={shape.draggable ? () => setDragged(item.id) : undefined}
                    onDrop={
                        shape.draggable && onDropOn
                            ? () => {
                                  if (dragged && dragged !== item.id) onDropOn(dragged, item.id);
                                  setDragged(null);
                              }
                            : undefined
                    }
                />
                {open &&
                    // One chapter is not a level worth drawing — its parts sit straight under the book.
                    (chapters.length > 1
                        ? chapters.map((chapter) => chapterRow(item, chapter, depth + 1))
                        : parts.map((output) => partRow(output, depth + 1, false)))}
            </div>
        );
    };

    /** Ticking a chapter ticks its parts: the chapter is a projection, so it holds no id of its own. */
    const chapterRow = (item: Item, chapter: Chapter, depth: number) => {
        const key = `${item.id}:${chapter.key}`;
        const open = openChapters.has(key);
        const ticked = chapter.outputs.filter((output) => selected.has(output.id)).length;

        return (
            <div key={key}>
                <Row
                    label={chapter.label}
                    depth={depth}
                    expanded={chapter.outputs.length > 1 ? open : undefined}
                    onToggle={
                        chapter.outputs.length > 1
                            ? () => toggle(openChapters, key, setOpenChapters)
                            : undefined
                    }
                    // The chapter is on the watch only when every part of it is. (ADR-0007)
                    tick={chapter.outputs.every((output) => output.onWatch)}
                    checked={ticked === chapter.outputs.length}
                    indeterminate={ticked > 0 && ticked < chapter.outputs.length}
                    onCheck={
                        onSelect
                            ? (next) => onSelect(chapter.outputs.map((output) => output.id), next)
                            : undefined
                    }
                    clickToCheck={Boolean(onSelect)}
                    onUnstage={
                        onDiscard
                            ? () => onDiscard(chapter.outputs.map((output) => output.id))
                            : undefined
                    }
                />
                {open && chapter.outputs.map((output) => partRow(output, depth + 1, true))}
            </div>
        );
    };

    const partRow = (output: Output, depth: number, nested: boolean) => (
        <Row
            key={output.id}
            label={nested ? partOnlyLabel(output) : partLabel(output)}
            depth={depth}
            // The output is the unit a sync sends, so it is the unit a tick describes.
            tick={output.onWatch}
            checked={selected.has(output.id)}
            onCheck={onSelect ? (next) => onSelect([output.id], next) : undefined}
            clickToCheck={Boolean(onSelect)}
            onUnstage={onDiscard ? () => onDiscard([output.id]) : undefined}
        />
    );

    const folderRow = (group: Group) => {
        const ids = group.items.map((item) => item.id);
        const shapes = group.items.map(plan);
        const open = openGroups.has(group.groupId);
        const running = shapes.some((shape) => shape.spinning);
        const checkedCount = group.items.filter((item, i) => isTicked(item, shapes[i])).length;
        const { completed, total } = groupProgress(group);

        // One badge on the folder when its items agree; when they differ each row carries its own.
        const shared = shapes.every((shape) => shape.badge === shapes[0].badge)
            ? shapes[0].badge
            : undefined;

        return (
            <div key={group.groupId}>
                <Row
                    label={`${group.groupName}/`}
                    badge={shared}
                    expanded={open}
                    onToggle={() => toggle(openGroups, group.groupId, setOpenGroups)}
                    // Closed by default, so the count is the only thing saying how much is in there.
                    counter={running || !open ? { completed, expected: total } : null}
                    spinning={running}
                    checked={checkedCount === ids.length}
                    indeterminate={checkedCount > 0 && checkedCount < ids.length}
                    onCheck={
                        onSelect ? (checked) => onSelect(group.items.flatMap(idsFor), checked) : undefined
                    }
                    clickToCheck={Boolean(onSelect) && open}
                    onCancel={running ? () => onCancel(ids) : undefined}
                    onUnstage={
                        onUnstage && shapes.every((shape) => shape.unstageable)
                            ? () => onUnstage(ids)
                            : undefined
                    }
                    onRevert={
                        onRevert && !running && shapes.every((shape) => shape.revertable)
                            ? () => onRevert(ids)
                            : undefined
                    }
                    onDelete={
                        onDelete && !running && shapes.every((shape) => shape.deletable)
                            ? () => onDelete(ids)
                            : undefined
                    }
                />
                {open && group.items.map((item) => itemRow(item, 1, shared != null))}
            </div>
        );
    };

    return (
        <section className={`cell${hidden ? ' cell-hidden' : ''}`}>
            {title && (
                <h2 className="cell-title">
                    {onToggleHidden && (
                        <button
                            className="row-icon"
                            onClick={onToggleHidden}
                            title={hidden ? 'Show this section' : 'Collapse to the heading'}
                        >
                            {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                    )}
                    {title}
                    {hidden && (
                        <span className="cell-count">
                            {/* The column's buttons act on rows this heading is hiding; the count is what says so. */}
                            {ticked > 0 && <span className="cell-ticked">{ticked} ticked</span>}
                            {mine.length}
                        </span>
                    )}
                </h2>
            )}
            {!hidden && (
                <div className="cell-body">
                    {groups.length === 0 && empty && <p className="cell-empty">{empty}</p>}
                    {groups.map((group) =>
                        isFolder(group) ? folderRow(group) : itemRow(group.items[0], 0),
                    )}
                </div>
            )}
        </section>
    );
};

export default Cell;
