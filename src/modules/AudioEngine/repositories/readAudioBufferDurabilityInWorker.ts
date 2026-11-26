import type { AudioBufferDurabilityRequest } from '../models/AudioBufferDurabilityMessage';

const WORKER_READ_TIMEOUT_MS = 30_000;

function isCompleteRevisionReply(response: unknown): response is { revisions: unknown[] } {
    return (
        response !== null &&
        typeof response === 'object' &&
        'status' in response &&
        response.status === 'complete' &&
        Object.keys(response).length === 2 &&
        'revisions' in response &&
        Array.isArray(response.revisions)
    );
}

function readRevisions(response: unknown, expectedCount: number): (string | null)[] | undefined {
    if (!isCompleteRevisionReply(response) || response.revisions.length !== expectedCount) {
        return undefined;
    }
    const revisions: (string | null)[] = [];
    for (const value of response.revisions) {
        if (value !== null && (typeof value !== 'string' || value.trim().length === 0)) {
            return undefined;
        }
        revisions.push(value);
    }
    return revisions;
}

function workerUnavailable(error: unknown): boolean {
    return error instanceof DOMException && (error.name === 'NotSupportedError' || error.name === 'SecurityError');
}

/** Undefined permits a renderer read only when Worker capability is unavailable. */
export async function readAudioBufferDurabilityInWorker(
    ids: readonly string[]
): Promise<(string | null)[] | undefined> {
    if (ids.length === 0) {
        return [];
    }
    if (typeof Worker !== 'function') {
        return undefined;
    }
    let worker: Worker;
    try {
        worker = new Worker(new URL('../workers/audioBufferDurabilityWorker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
        if (workerUnavailable(error)) {
            return undefined;
        }
        throw error;
    }

    return new Promise((resolve, reject) => {
        function cleanup(): void {
            clearTimeout(timeout);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        }
        function fail(error: Error): void {
            cleanup();
            reject(error);
        }

        const timeout = setTimeout(() => fail(new Error('Audio durability worker timed out')), WORKER_READ_TIMEOUT_MS);
        worker.onerror = () => fail(new Error('Audio durability worker failed'));
        worker.onmessageerror = () => fail(new Error('Audio durability worker reply could not be decoded'));
        worker.onmessage = ({ data }: MessageEvent<unknown>) => {
            if (
                data !== null &&
                typeof data === 'object' &&
                'status' in data &&
                data.status === 'unavailable' &&
                Object.keys(data).length === 1
            ) {
                cleanup();
                resolve(undefined);
                return;
            }
            const revisions = readRevisions(data, ids.length);
            if (revisions === undefined) {
                fail(new Error('Audio durability worker did not return the requested revisions'));
                return;
            }
            cleanup();
            resolve(revisions);
        };

        const request: AudioBufferDurabilityRequest = { ids };
        try {
            worker.postMessage(request);
        } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
        }
    });
}
