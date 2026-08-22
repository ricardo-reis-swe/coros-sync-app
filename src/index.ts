import { app, BrowserWindow, dialog, session, WebContents } from 'electron';
import { registerGateway } from './main/ipc/gateway.ipc';
import { reconcileOnStartup } from './main/coordinators/processing.coordinator';
import { openSchema } from './main/adapters/db/db';
import { isPackaged } from './main/utils/resolvers';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Forge's Webpack plugin generates these at build time.
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

let mainWindow: BrowserWindow;

// `connect-src 'none'` makes ADR-0014's zero-network structural. Packaged only: the dev server needs its own socket.
const CSP =
    "default-src 'self' file:; script-src 'self' file:; style-src 'self' file: 'unsafe-inline'; " +
    "img-src 'self' file: data:; font-src 'self' file: data:; connect-src 'none'; " +
    "object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/** The renderer never navigates and never opens a window; both are how a network request gets out. */
const denyNavigation = (contents: WebContents): void => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Compared against the current URL, so a dev-server reload still passes and a link never does.
    contents.on('will-navigate', (event, url) => {
        if (url !== contents.getURL()) event.preventDefault();
    });
};

const createWindow = async (): Promise<void> => {
    // Before anything writes: creates, migrates, or refuses — nothing may touch the db earlier. (ADR-0037)
    const drift = openSchema();
    if (drift) {
        dialog.showErrorBox('Incompatible library', drift);
        app.quit();
        return;
    }

    if (isPackaged()) {
        session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': [CSP],
                },
            }),
        );
    }

    // Three columns that never collapse: below ~940 the grid stops being a grid.
    mainWindow = new BrowserWindow({
        height: 860,
        width: 1280,
        minHeight: 620,
        minWidth: 940,
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            // Declared, not inherited: these three ARE the sandbox CONTRACTS §4 describes.
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    denyNavigation(mainWindow.webContents);

    await mkdir(join(app.getPath('userData'), 'library'), { recursive: true });
    registerGateway(mainWindow);

    // Stranded `processing` items: same cleanup as a failed child. (docs/05 §6)
    await reconcileOnStartup();

    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
    if (!isPackaged()) mainWindow.webContents.openDevTools();
};

app.on('ready', createWindow);

// macOS keeps the app alive with no windows; every other platform quits.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// macOS: the dock icon re-opens a window after the last one closed.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
