import { app } from 'electron';
import path from 'path';

/** Here and nowhere else: this module is the only one that may read `app.isPackaged`. (ARCHITECTURE §9.2) */
export const isPackaged = () => app.isPackaged;

// `.exe` lives here too, so no adapter ever spells a platform. (ARCHITECTURE §9.2)
const bundled = (name: string): string => {
    const file = process.platform === 'win32' ? `${name}.exe` : name;

    return app.isPackaged
        ? path.join(process.resourcesPath, 'bin', file)
        : path.join(app.getAppPath(), 'resources', 'bin', file);
};

export const resolveFfmpeg = () => bundled('ffmpeg');

export const resolveFfprobe = () => bundled('ffprobe');

/** The copy we shipped. A user's own is a setting the adapter reads, not a path we build. (ADR-0055) */
export const resolveYtdlp = () => bundled('yt-dlp');
