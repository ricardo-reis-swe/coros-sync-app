import { app } from 'electron';
import path from 'path';

/** Here and nowhere else: this module is the only one that may read `app.isPackaged`. (docs/07 §3) */
export const isPackaged = () => app.isPackaged;

export const resolveFfmpeg = () => {
    if (app.isPackaged) {
        return `${process.resourcesPath}/bin/ffmpeg`;
    } else {
        return path.join(app.getAppPath(), 'resources', 'bin', 'ffmpeg');
    }
};

export const resolveFfprobe = () => {
    if (app.isPackaged) {
        return `${process.resourcesPath}/bin/ffprobe`;
    } else {
        return path.join(app.getAppPath(), 'resources', 'bin', 'ffprobe');
    }
};
