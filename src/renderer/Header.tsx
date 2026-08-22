import { ChevronDown, EllipsisVertical, Settings } from 'lucide-react';
import { ItemType } from '../shared/data.types';
import Menu, { MenuItem } from './Menu';

type HeaderProps = {
    onImport: (type: ItemType, isFolder: boolean) => void;
    onImportUrls: (multi: boolean) => void;
    onChooseDevice: () => void;
    onOpenSettings: () => void;
    onOpenLogFolder: () => void;
    onCopyLogs: () => void;
    onOpenAppData: () => void;
};

/** The default action is the common one; the arrow is where the rarer sibling lives. */
const SplitButton = ({
    label,
    title,
    onMain,
    items,
}: {
    label: string;
    title: string;
    onMain: () => void;
    items: MenuItem[];
}) => (
    <span className="split">
        <button className="split-main" onClick={onMain}>
            {label}
        </button>
        <Menu
            className="split-menu"
            buttonClassName="split-trigger"
            title={title}
            align="left"
            trigger={<ChevronDown className="chevron" size={12} strokeWidth={2.5} />}
            items={items}
        />
    </span>
);

const Header = ({
    onImport,
    onImportUrls,
    onChooseDevice,
    onOpenSettings,
    onOpenLogFolder,
    onCopyLogs,
    onOpenAppData,
}: HeaderProps) => (
    <header className="app-header">
        <span className="header-left">
            <SplitButton
                label="Import Media"
                title="Import Media — folder"
                onMain={() => onImport('media', false)}
                // Files is the button itself; repeating it here would be a menu of one real choice.
                items={[{ label: 'Choose a folder…', onSelect: () => onImport('media', true) }]}
            />
            <SplitButton
                label="Import Audiobook"
                title="Import Audiobook — folder"
                onMain={() => onImport('audiobook', false)}
                items={[{ label: 'Choose a folder…', onSelect: () => onImport('audiobook', true) }]}
            />
            {/* Lands in the library as `media` like any other import; the mp3 is Process's. (ADR-0027) */}
            <SplitButton
                label="Import URL"
                title="Import URL — list"
                onMain={() => onImportUrls(false)}
                items={[{ label: 'Import URLs list…', onSelect: () => onImportUrls(true) }]}
            />
        </span>

        <h1 className="header-title">Coros Sync</h1>

        <span className="header-right">
            <button
                onClick={onChooseDevice}
                title="Pick the Music folder inside the watch’s USB volume — not the volume itself"
            >
                Choose Music folder
            </button>
            {/* Out of the menu and onto the header: it is the only item in there anyone opens twice. */}
            <button className="settings-button" onClick={onOpenSettings}>
                <Settings size={17} />
                Settings
            </button>
            {/* What is left is diagnostics, so the trigger stops being a gear. */}
            <Menu
                title="More"
                buttonClassName="gear"
                trigger={<EllipsisVertical size={20} />}
                items={[
                    { label: 'Open log folder', onSelect: onOpenLogFolder },
                    { label: 'Copy logs', onSelect: onCopyLogs },
                    { label: 'Open app data', onSelect: onOpenAppData },
                ]}
            />
        </span>
    </header>
);

export default Header;
