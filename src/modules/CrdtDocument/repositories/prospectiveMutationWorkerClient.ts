import {
    type ProspectiveMutationWorkerRequest,
    type ProspectiveMutationWorkerResult,
} from '../models/ProspectiveMutationWorkerProtocol';

/** Each private job owns its transferable seed, callbacks, deadline and Worker. */
export function requestProspectiveMutation(
    request: ProspectiveMutationWorkerRequest,
    signal: AbortSignal
): Promise<ProspectiveMutationWorkerResult> {
    if (signal.aborted) {
        return Promise.reject(signal.reason ?? new DOMException('Prospective mutation cancelled', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
        let worker: Worker;
        try {
            worker = new Worker(new URL('../workers/prospectiveMutationWorker.ts', import.meta.url), {
                type: 'module',
            });
        } catch (error) {
            reject(error);
            return;
        }
        let settled = false;
        const finish = (result: ProspectiveMutationWorkerResult | undefined, error?: unknown): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
            if (result) {
                resolve(result);
            } else {
                reject(error);
            }
        };
        const abort = (): void =>
            finish(undefined, signal.reason ?? new DOMException('Prospective mutation cancelled', 'AbortError'));
        const timer = setTimeout(() => finish(undefined, new Error('Prospective mutation Worker timed out')), 30_000);
        worker.onmessage = ({ data }: MessageEvent<unknown>): void => {
            if (typeof data !== 'object' || data === null || !('status' in data)) {
                finish(undefined, new Error('Invalid prospective mutation Worker response'));
                return;
            }
            if (
                data.status === 'complete' &&
                'changes' in data &&
                Array.isArray(data.changes) &&
                data.changes.length <= 1 &&
                data.changes.every(
                    (bytes: unknown): bytes is Uint8Array<ArrayBuffer> =>
                        bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer && bytes.byteLength > 0
                ) &&
                'heads' in data &&
                Array.isArray(data.heads) &&
                data.heads.every(
                    (head: unknown): head is string => typeof head === 'string' && /^[a-f0-9]{64}$/.test(head)
                ) &&
                new Set(data.heads).size === data.heads.length
            ) {
                finish({
                    changes: data.changes.map(
                        (bytes) => new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
                    ),
                    heads: data.heads,
                });
                return;
            }
            const message =
                data.status === 'failed' && 'message' in data && typeof data.message === 'string'
                    ? data.message
                    : 'Invalid prospective mutation Worker response';
            finish(undefined, new Error(message));
        };
        worker.onerror = (): void => finish(undefined, new Error('Prospective mutation Worker failed'));
        worker.onmessageerror = (): void => finish(undefined, new Error('Prospective mutation Worker message failed'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
            abort();
            return;
        }
        try {
            worker.postMessage(request, [request.seed.buffer]);
        } catch (error) {
            finish(undefined, error);
        }
    });
}
