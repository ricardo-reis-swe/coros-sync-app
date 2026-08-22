import { app } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { runChild } from '../engine/spawn.engine';
import { DownloadError } from './download.types';

// Fixed, and not a template: there is no field to poison, and no GitHub API to be rate-limited by.
const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const TIMEOUT_MS = 180_000;

/** One asset per platform+arch; macOS ships universal2, so both mac arches take the same file. */
const assetName = (): string => {
    if (process.platform === 'win32') return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';

    return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
};

/** Outside the bundle, always: writing into `resources/bin` breaks the macOS signature. (ADR-0056) */
export const managedBinDir = (): string => path.join(app.getPath('userData'), 'bin');

const get = async (url: string): Promise<Response> => {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new DownloadError(`${url} returned ${response.status}`);

    return response;
};

/** `<sha256>  <filename>` per line; the asset we asked for is the only line that matters. */
const expectedHash = async (asset: string): Promise<string> => {
    const sums = await (await get(`${BASE}/SHA2-256SUMS`)).text();

    const line = sums
        .split('\n')
        .map((row) => row.trim().split(/\s+/))
        .find(([, name]) => name === asset);

    if (!line) throw new DownloadError(`SHA2-256SUMS names no ${asset}`);

    return line[0].toLowerCase();
};

/** Hashed on the way to disk, so the bytes are never read twice and never held whole in main. */
const streamToFile = async (response: Response, destination: string): Promise<string> => {
    const hash = createHash('sha256');
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);

    body.on('data', (chunk: Buffer) => hash.update(chunk));
    await pipeline(body, createWriteStream(destination));

    return hash.digest('hex');
};

/** Verify, THEN make it executable — the rename is the confirmation point, as on the device. (ADR-0010) */
export const fetchLatestYtdlp = async (): Promise<{ binPath: string; version: string }> => {
    const asset = assetName();
    const dir = managedBinDir();
    await mkdir(dir, { recursive: true });

    const binPath = path.join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    const partPath = `${binPath}.part`;

    try {
        const wanted = await expectedHash(asset);
        const got = await streamToFile(await get(`${BASE}/${asset}`), partPath);

        if (got !== wanted) throw new DownloadError(`checksum mismatch — got ${got.slice(0, 12)}…`);

        await rename(partPath, binPath);
        await chmod(binPath, 0o755);
    } catch (err) {
        // Nothing half-written survives to be spawned later; a failed update changes nothing.
        await rm(partPath, { force: true });
        throw err;
    }

    return { binPath, version: await readVersion(binPath) };
};

/** Asked, never parsed out of a redirect: the binary is the only thing that knows what it is. */
const readVersion = async (binPath: string): Promise<string> => {
    const { stdout } = await runChild(binPath, ['--version'], new AbortController().signal);

    return stdout.trim().split('\n')[0]?.trim() || 'unknown';
};
