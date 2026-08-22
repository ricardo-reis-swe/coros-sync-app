/* The Engine Adapter's contract. No ffmpeg vocabulary crosses this boundary. */

export type ProbeResult = {
    durationSec: number;
    codec?: string;
    bitrateKbps?: number;
    chapters: { index: number; title?: string; startSec: number; endSec: number }[];
};

// One task = one engine invocation = one child = one output file. (ADR-0008)
export type TranscodeTask = {
    sourcePath: string;
    outPath: string;
    startSec?: number; // the cut — absent means "the whole source"
    endSec?: number;
    bitrate: number | 'source'; // kbps, or 'source' to copy the stream untouched (ADR-0043)
    title?: string; // per-file tags: the reason one task is one child
    author?: string;
};

// A failed child. Carries a reason the coordinator can log; never a raw stderr dump.
export class EngineError extends Error {
    reason: string;
    constructor(reason: string) {
        super(reason);
        this.name = 'EngineError';
        this.reason = reason;
    }
}
