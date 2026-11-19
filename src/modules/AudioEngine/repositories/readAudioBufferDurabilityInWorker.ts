import { type AudioBufferDurabilityRequest } from '../models/AudioBufferDurability';

const AUDIO_BUFFER_DURABILITY_TIMEOUT_MS = 30_000;

function readRevisions(value: unknown, expectedCount: number): (string | null)[] | undefined {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('status' in value) ||
        value.status !== 'complete' ||
        !('revisions' in value) ||
        !Array.isArray(value.revisions) ||
        value.revisions.length !== expectedCount
    ) {
        return undefined;
    }
    const candidates: readonly unknown[] = value.revisions;
    const revisions: (string | null)[] = [];
    for (const revision of candidates) {
        if (revision !== null && (typeof revision !== 'string' || revision.trim().length === 0)) {
            return undefined;
        }
        revisions.push(revision);
    }
    return revisions;
}

/** One read owns a Worker, its deadline, and no PCM in the renderer. */
export function readAudioBufferDurabilityInWorker(ids: readonly string[]): Promise<(string | null)[] | undefined> {
    return new Promise((resolve, reject) => {
        let worker: Worker;
        try {
            worker = new Worker(new URL('../workers/audioBufferDurabilityWorker.ts', import.meta.url), {
                type: 'module',
            });
        } catch {
            resolve(undefined);
            return;
        }

        function cleanup(): void {
            clearTimeout(timeout);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        }
        function fail(message: string): void {
            cleanup();
            reject(new Error(message));
        }
        function unavailable(): void {
            cleanup();
            resolve(undefined);
        }

        const timeout = setTimeout(
            () => fail('Audio buffer durability Worker timed out'),
            AUDIO_BUFFER_DURABILITY_TIMEOUT_MS
        );
        worker.onerror = unavailable;
        worker.onmessageerror = () => fail('Audio buffer durability Worker returned an unreadable result');
        worker.onmessage = ({ data }: MessageEvent<unknown>): void => {
            if (typeof data === 'object' && data !== null && 'status' in data && data.status === 'unavailable') {
                unavailable();
                return;
            }
            const revisions = readRevisions(data, ids.length);
            if (!revisions) {
                fail('Audio buffer durability Worker did not complete its read');
                return;
            }
            cleanup();
            resolve(revisions);
        };
        const request: AudioBufferDurabilityRequest = { ids };
        try {
            worker.postMessage(request);
        } catch {
            fail('Audio buffer durability Worker could not start its read');
        }
    });
}
