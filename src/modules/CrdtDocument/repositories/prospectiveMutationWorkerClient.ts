import { type ProspectiveMutationWorkerRequest } from '../models/ProspectiveMutationWorkerProtocol';

/** Each private job owns its transferable seed, callbacks, deadline and Worker. */
export function requestProspectiveMutation(
    request: ProspectiveMutationWorkerRequest,
    signal: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
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
        const finish = (bytes: Uint8Array<ArrayBuffer> | undefined, error?: unknown): void => {
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
            if (bytes) {
                resolve(bytes);
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
                'bytes' in data &&
                data.bytes instanceof Uint8Array &&
                data.bytes.buffer instanceof ArrayBuffer &&
                data.bytes.byteLength > 0
            ) {
                finish(new Uint8Array(data.bytes.buffer, data.bytes.byteOffset, data.bytes.byteLength));
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
