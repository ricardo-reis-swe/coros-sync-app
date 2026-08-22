export type DeviceFile = {
    filename: string;
    sizeBytes: number;
    // What the watch orders by — timestamp first, directory position only breaking its ties. (ADR-0049)
    mtimeMs: number;
    ino: number;
};

export type DeviceErrorKind = 'DeviceGone' | 'IoError' | 'Full' | 'Denied';

/** Four kinds, uniformly. No "check connected, then act" helper — that race cannot be won. */
export class DeviceError extends Error {
    kind: DeviceErrorKind;
    /** What the user can do about it, when the OS is the cause. The message stays the errno. (ADR-0045) */
    remedy?: string;

    constructor(kind: DeviceErrorKind, message: string, remedy?: string) {
        super(message);
        this.name = 'DeviceError';
        this.kind = kind;
        this.remedy = remedy;
    }
}

// Every in-flight write wears it; the rename that removes it is the confirmation. (ADR-0010)
export const PART_SUFFIX = '.part';
