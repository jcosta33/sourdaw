import { ZipArchiveError } from './extractGuardedZip';
import { type GuardedZipWorkerRequest, type GuardedZipWorkerResponse } from './runGuardedZipWorkerRequest';

type ExtractSingleGuardedZipEntryInput = {
    bytes: Uint8Array;
    suffix: string;
    signal?: AbortSignal;
};

type ExtractSingleGuardedZipEntryOutput = Promise<{
    path: string;
    data: Uint8Array<ArrayBuffer>;
}>;

export function extractSingleGuardedZipEntry({
    bytes,
    suffix,
    signal,
}: ExtractSingleGuardedZipEntryInput): ExtractSingleGuardedZipEntryOutput {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        const worker = new Worker(new URL('./extractGuardedZip.worker.ts', import.meta.url), { type: 'module' });
        let settled = false;

        function finish(callback: () => void): void {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            worker.terminate();
            callback();
        }

        function onAbort(): void {
            finish(() => reject(new DOMException('Aborted', 'AbortError')));
        }

        worker.onmessage = (event: MessageEvent<GuardedZipWorkerResponse>) => {
            const response = event.data;
            if (response.type === 'error') {
                finish(() => reject(new ZipArchiveError(response.message)));
                return;
            }
            finish(() => resolve({ path: response.path, data: new Uint8Array(response.data) }));
        };
        worker.onerror = (event) => {
            finish(() => reject(new Error(event.message || 'Guarded ZIP extraction worker failed')));
        };
        worker.onmessageerror = () => {
            finish(() => reject(new Error('Guarded ZIP extraction worker returned an unreadable response')));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        const transferableBytes =
            bytes.buffer instanceof ArrayBuffer &&
            bytes.byteOffset === 0 &&
            bytes.byteLength === bytes.buffer.byteLength
                ? bytes.buffer
                : bytes.slice().buffer;
        const request: GuardedZipWorkerRequest = { bytes: transferableBytes, suffix };
        try {
            worker.postMessage(request, [transferableBytes]);
        } catch (error) {
            finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
    });
}
