import { spawn } from 'node:child_process';
import { EngineError } from './engine.types';

const STDERR_TAIL = 4000;

/** Settles only when the child is gone; abort means SIGKILL, or the pool overshoots N. (ADR-0023) */
export const runChild = (
    bin: string,
    args: string[],
    signal: AbortSignal,
): Promise<{ stdout: string }> =>
    new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new EngineError('cancelled before spawn'));
            return;
        }

        const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-STDERR_TAIL);
        });

        const onAbort = () => child.kill('SIGKILL');
        signal.addEventListener('abort', onAbort, { once: true });
        const done = () => signal.removeEventListener('abort', onAbort);

        child.on('error', (err) => {
            done();
            reject(new EngineError(`${bin} failed to start: ${err.message}`));
        });

        child.on('close', (code, killedBy) => {
            done();

            if (code === 0) {
                resolve({ stdout });
                return;
            }
            if (killedBy) {
                reject(new EngineError(`${bin} killed by ${killedBy}`));
                return;
            }
            reject(new EngineError(`${bin} exited ${code}: ${lastLine(stderr)}`));
        });
    });

const lastLine = (stderr: string): string =>
    stderr.trimEnd().split('\n').pop()?.trim() ?? 'no output';
