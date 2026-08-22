import { ChevronDown, EllipsisVertical, Settings } from 'lucide-react';
import { ItemType } from '../shared/data.types';
import Menu from './Menu';

type HeaderProps = {
    onImport: (type: ItemType, isFolder: boolean) => void;
    onChooseDevice: () => void;
    onOpenSettings: () => void;
    onOpenLogFolder: () => void;
    onCopyLogs: () => void;
    onOpenAppData: () => void;
};

/** The default action is files; the arrow is where the rarer folder import lives. */
const ImportButton = ({
    label,
    type,
    onImport,
}: {
    label: string;
    type: ItemType;
    onImport: HeaderProps['onImport'];
}) => (
    <span className="split">
        <button className="split-main" onClick={() => onImport(type, false)}>
            {label}
        </button>
        <Menu
            className="split-menu"
            buttonClassName="split-trigger"
            title={`${label} — folder`}
            align="left"
            trigger={<ChevronDown className="chevron" size={12} strokeWidth={2.5} />}
            // Files is the button itself; repeating it here would be a menu of one real choice.
            items={[{ label: 'Choose a folder…', onSelect: () => onImport(type, true) }]}
        />
    </span>
);

const Header = ({
    onImport,
    onChooseDevice,
    onOpenSettings,
    onOpenLogFolder,
    onCopyLogs,
    onOpenAppData,
}: HeaderProps) => (
    <header className="app-header">
        <span className="header-left">
            <ImportButton label="Import Media" type="media" onImport={onImport} />
            <ImportButton label="Import Audiobook" type="audiobook" onImport={onImport} />
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
