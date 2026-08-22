import { resolveFfprobe } from '../../utils/resolvers';
import { EngineError, ProbeResult } from './engine.types';
import { runChild } from './spawn.engine';

const PROBE_ARGS = [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-show_chapters',
];

/** The item's first pool task, and its only source-exists check — no pre-flight stat. (ADR-0008) */
export const probe = async (sourcePath: string, signal: AbortSignal): Promise<ProbeResult> => {
    const { stdout } = await runChild(resolveFfprobe(), [...PROBE_ARGS, sourcePath], signal);

    let parsed: FfprobeJson;
    try {
        parsed = JSON.parse(stdout) as FfprobeJson;
    } catch {
        throw new EngineError(`ffprobe returned unreadable output for ${sourcePath}`);
    }

    const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    if (!audio) {
        throw new EngineError(`no audio stream in ${sourcePath}`);
    }

    const durationSec = toNumber(parsed.format?.duration) ?? 0;
    // ffprobe reports bit_rate in bits/sec, as a string; the app speaks kbps everywhere.
    const bitrateBps = toNumber(audio.bit_rate) ?? toNumber(parsed.format?.bit_rate);

    return {
        durationSec,
        codec: audio.codec_name,
        bitrateKbps: bitrateBps === undefined ? undefined : Math.round(bitrateBps / 1000),
        chapters: (parsed.chapters ?? []).map((chapter, i) => ({
            index: i + 1,
            title: chapter.tags?.title,
            startSec: toNumber(chapter.start_time) ?? 0,
            endSec: toNumber(chapter.end_time) ?? durationSec,
        })),
    };
};

const toNumber = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
};

/* ffprobe's JSON, adapter-private — it never leaves this module. */
type FfprobeJson = {
    streams?: { codec_type?: string; codec_name?: string; bit_rate?: string }[];
    format?: { duration?: string; bit_rate?: string };
    chapters?: { start_time?: string; end_time?: string; tags?: { title?: string } }[];
};
