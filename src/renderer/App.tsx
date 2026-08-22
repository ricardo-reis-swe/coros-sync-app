import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { Item, ItemType } from '../shared/data.types';
import { IpcUpdateSettingsPayload } from '../shared/ipc.types';
import DeviceColumn, { SyncMode } from './DeviceColumn';
import Header from './Header';
import LibraryColumn from './LibraryColumn';
import NotifyStrip from './NotifyStrip';
import ProcessedColumn from './ProcessedColumn';
import SettingsModal from './SettingsModal';
import UrlImportModal from './UrlImportModal';
import {
    isPicked,
    isStaged,
    isTranscoded,
    listedOutputIds,
    orderedItems,
    outputsOf,
    rebuildCost,
    sessionOutputIds,
} from './derive';
import { useColumnWidths } from './useColumnWidths';
import { invoke, useMirror } from './useMirror';

const App = () => {
    const { snapshot, progress, transfer, download, toasts, dismiss } = useMirror();
    const { grid, template, startDrag } = useColumnWidths();

    // One set per column that picks, and column 3 does not: a tick acts where it was made. (ADR-0051)
    const [libraryTicks, setLibraryTicks] = useState<Set<string>>(new Set());
    const [processedTicks, setProcessedTicks] = useState<Set<string>>(new Set());
    // Not a selection — the send list, written by `[Stage]` and never by a click in column 3. (ADR-0053)
    const [sendList, setSendList] = useState<Set<string>>(new Set());
    const [mode, setMode] = useState<SyncMode>('append-new');
    const [settingsOpen, setSettingsOpen] = useState(false);
    // `false` is closed; the boolean is which field the one modal shows.
    const [urlImport, setUrlImport] = useState<false | { multi: boolean }>(false);

    const items = snapshot?.items ?? [];
    const outputs = snapshot?.outputs ?? [];
    const device = snapshot?.device ?? {
        reach: 'unreachable' as const,
        syncing: false,
        stopping: false,
        freeBytes: null,
        files: [],
    };

    const stagedOrder = useMemo(() => {
        const staged = items.filter(isStaged);
        // Media precedes audiobooks: one sequence, rendered in two cells.
        return (['media', 'audiobook'] as ItemType[]).flatMap((type) =>
            orderedItems(staged, type),
        );
    }, [items]);

    // The button's count, its payload and column 3's staged region are all this one list. (ADR-0047)
    const session = useMemo(
        () => sessionOutputIds(stagedOrder, outputs, sendList, mode),
        [stagedOrder, outputs, sendList, mode],
    );

    const ticker =
        (set: Dispatch<SetStateAction<Set<string>>>) => (itemIds: string[], checked: boolean) =>
            set((current) => {
                const next = new Set(current);
                itemIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
                return next;
            });

    // Reads the tick a row shows: a part tick, or `⤓`, picks its item too. (ARCHITECTURE §10)
    const pickedIn = (ticks: Set<string>, predicate: (item: Item) => boolean) =>
        items
            .filter((item) => predicate(item) && isPicked(item, outputs, ticks))
            .map((item) => item.id);

    // `state` is the item's, so `[Stage]` puts the ticked parts on the send list; union, so a press adds. (ADR-0052)
    const staging = useMemo(
        () => items.filter((item) => isTranscoded(item) && isPicked(item, outputs, processedTicks)),
        [items, outputs, processedTicks],
    );

    // One list, so `Stage (N)` counts the parts it is about to send rather than the rows. (ADR-0054)
    const stagePicks = useMemo(
        () =>
            staging.flatMap((item) =>
                outputsOf(outputs, item.id)
                    .map((output) => output.id)
                    .filter((id) => processedTicks.has(id)),
            ),
        [staging, outputs, processedTicks],
    );

    const stage = () => {
        setSendList((current) => new Set([...current, ...stagePicks]));
        void invoke('stage', { itemIds: staging.map((item) => item.id) });
    };

    // `⇤` below the item row edits the send list, not `state` — until the last part goes. (ADR-0054)
    const discard = (outputIds: string[]) => {
        const dropping = new Set(outputIds);
        const touched = items.filter(
            (item) =>
                isStaged(item) &&
                outputsOf(outputs, item.id).some((output) => dropping.has(output.id)),
        );

        setSendList((current) => {
            const next = new Set(current);
            touched.forEach((item) => {
                // Materialised before it is subtracted from: an unlisted item means all of it.
                const keeping = listedOutputIds(item, outputs, current).filter(
                    (id) => !dropping.has(id),
                );
                outputsOf(outputs, item.id).forEach((output) => next.delete(output.id));
                keeping.forEach((id) => next.add(id));
            });
            return next;
        });

        const emptied = touched
            .filter((item) =>
                listedOutputIds(item, outputs, sendList).every((id) => dropping.has(id)),
            )
            .map((item) => item.id);
        if (emptied.length > 0) void invoke('unstage', { itemIds: emptied });
    };

    const reorder = (dragged: string, target: string) => {
        const moving = stagedOrder.find((item) => item.id === dragged);
        const onto = stagedOrder.find((item) => item.id === target);
        // Media and audiobooks are separate blocks; there is no gesture that interleaves them.
        if (!moving || !onto || moving.type !== onto.type) return;

        const within = stagedOrder.filter((item) => item.type === moving.type).map((i) => i.id);
        const ordered = within.filter((id) => id !== dragged);
        ordered.splice(ordered.indexOf(target), 0, dragged);

        // The new order arrives back on the snapshot; nothing here writes the mirror. (ADR-0011)
        void invoke('reorder', { type: moving.type, ordered });
    };

    const startSync = () => {
        if (mode === 'reorder-all' && !confirm(rebuildCost(session, outputs))) return;

        void invoke('sync', { mode, ordered: session });
    };

    const deleteFromDevice = (filenames: string[], managed: boolean) => {
        // Anything managed can be put back; a file this app never made, it cannot. (ADR-0029)
        const what = filenames.length === 1 ? filenames[0] : `${filenames.length} files`;
        if (!managed && !confirm(`Delete ${what} from the watch? This app did not put them there.`)) {
            return;
        }
        void invoke('deleteFromDevice', { filenames });
    };

    const patchSettings = (patch: IpcUpdateSettingsPayload) => void invoke('updateSettings', patch);

    // Column 3 is always on screen, so ADR-0009's first trigger is the window being looked at.
    const mountPath = snapshot?.settings.mountPath ?? null;
    useEffect(() => {
        if (!mountPath) return;

        const rescan = () => void invoke('scanDevice');
        rescan();
        window.addEventListener('focus', rescan);

        return () => window.removeEventListener('focus', rescan);
    }, [mountPath]);

    return (
        <div className="app">
            <Header
                onImport={(type, isFolder) => void invoke('import', { type, isFolder })}
                onImportUrls={(multi) => setUrlImport({ multi })}
                onChooseDevice={() => void invoke('selectDeviceFolder')}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenLogFolder={() => void invoke('openLogFolder')}
                onCopyLogs={() => void invoke('copyLogs')}
                onOpenAppData={() => void invoke('openAppData')}
            />

            <main className="grid" ref={grid} style={{ gridTemplateColumns: template }}>
                <LibraryColumn
                    items={items}
                    outputs={outputs}
                    settings={snapshot?.settings ?? null}
                    progress={progress}
                    download={download}
                    selected={libraryTicks}
                    libraryEmpty={items.length === 0}
                    onCancelDownloads={() => void invoke('cancelDownloads')}
                    onSelect={ticker(setLibraryTicks)}
                    // The ticks stay: the rows leave `imported`, so the button goes dead. (ADR-0051)
                    onProcess={() =>
                        void invoke('process', {
                            itemIds: pickedIn(libraryTicks, (item) => item.state === 'imported'),
                        })
                    }
                    onCancel={(itemIds) => void invoke('cancelProcessing', { itemIds })}
                    onDelete={(itemIds) => void invoke('deleteItems', { itemIds })}
                    onRename={(item, title) => void invoke('updateItem', { itemId: item.id, title })}
                />

                <div
                    className="grid-divider"
                    onMouseDown={(event) => startDrag(0, event)}
                    title="Drag to resize"
                />

                <ProcessedColumn
                    items={items.filter(isTranscoded)}
                    outputs={outputs}
                    syncing={device.syncing}
                    selected={processedTicks}
                    stageCount={stagePicks.length}
                    onSelect={ticker(setProcessedTicks)}
                    onStage={stage}
                    onRevert={(itemIds) => void invoke('revertItems', { itemIds })}
                />

                <div
                    className="grid-divider"
                    onMouseDown={(event) => startDrag(1, event)}
                    title="Drag to resize"
                />

                <DeviceColumn
                    device={device}
                    items={items}
                    outputs={outputs}
                    mountPath={mountPath}
                    transfer={transfer}
                    session={session}
                    mode={mode}
                    onModeChange={setMode}
                    onSync={startSync}
                    onStop={() => void invoke('cancelSync')}
                    onUnstage={(itemIds) => void invoke('unstage', { itemIds })}
                    onDiscard={discard}
                    onReorder={reorder}
                    onRescan={() => void invoke('scanDevice')}
                    onDeleteFile={deleteFromDevice}
                    onEject={() => void invoke('ejectDevice')}
                />
            </main>

            {settingsOpen && snapshot && (
                <SettingsModal
                    settings={snapshot.settings}
                    onClose={() => setSettingsOpen(false)}
                    onPatch={patchSettings}
                    onChooseFolder={() => void invoke('selectDeviceFolder')}
                />
            )}

            {urlImport && (
                <UrlImportModal
                    multi={urlImport.multi}
                    onClose={() => setUrlImport(false)}
                    onImport={(urls) => void invoke('importUrls', { urls })}
                />
            )}

            <NotifyStrip toasts={toasts} onDismiss={dismiss} />
        </div>
    );
};

export default App;
