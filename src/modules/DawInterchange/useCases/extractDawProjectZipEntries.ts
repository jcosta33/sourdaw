import { ZipArchiveError, type ZipExtractionLimits } from '#/infra/archive/extractGuardedZip';

import {
    type DawProjectZipWorkerPhase,
    type DawProjectZipWorkerRequest,
    type DawProjectZipWorkerResponse,
} from './runDawProjectZipWorkerRequest';

type ExtractDawProjectZipEntriesInput = {
    bytes: Uint8Array;
    phase: DawProjectZipWorkerPhase;
    restrictLimits: Partial<ZipExtractionLimits>;
    signal?: AbortSignal;
};

type ExtractDawProjectZipEntriesOutput = Promise<{
    entries: Record<string, Uint8Array<ArrayBuffer>>;
}>;

/**
 * Runs guarded DAWproject ZIP extraction on a dedicated Worker so the
 * inflate/CRC loop never blocks the main thread (issue #3317). Mirrors the
 * shared `extractSingleGuardedZipEntry` worker-request pattern in
 * `#/infra/archive`, specialised for DAWproject's two extraction phases.
 */
export function extractDawProjectZipEntries({
    bytes,
    phase,
    restrictLimits,
    signal,
}: ExtractDawProjectZipEntriesInput): ExtractDawProjectZipEntriesOutput {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        const worker = new Worker(new URL('./dawProjectZip.worker.ts', import.meta.url), { type: 'module' });
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

        worker.onmessage = (event: MessageEvent<DawProjectZipWorkerResponse>) => {
            const response = event.data;
            if (response.type === 'error') {
                finish(() => reject(new ZipArchiveError(response.message)));
                return;
            }
            const entries: Record<string, Uint8Array<ArrayBuffer>> = {};
            for (const [path, buffer] of Object.entries(response.entries)) {
                entries[path] = new Uint8Array(buffer);
            }
            finish(() => resolve({ entries }));
        };
        worker.onerror = (event) => {
            finish(() => reject(new Error(event.message || 'DAWproject ZIP extraction worker failed')));
        };
        worker.onmessageerror = () => {
            finish(() => reject(new Error('DAWproject ZIP extraction worker returned an unreadable response')));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        const transferableBytes =
            bytes.buffer instanceof ArrayBuffer &&
            bytes.byteOffset === 0 &&
            bytes.byteLength === bytes.buffer.byteLength
                ? bytes.buffer
                : bytes.slice().buffer;
        const request: DawProjectZipWorkerRequest = { bytes: transferableBytes, phase, restrictLimits };
        try {
            worker.postMessage(request, [transferableBytes]);
        } catch (error) {
            finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
    });
}
