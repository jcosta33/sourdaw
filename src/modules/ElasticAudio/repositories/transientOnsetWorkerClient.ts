import { type TransientOnsetWorkerRequest, type TransientOnsetWorkerResult } from '../models/TransientOnsetWorker';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readHits(
    value: unknown,
    frameCount: number
): Extract<TransientOnsetWorkerResult, { status: 'complete' }> | null {
    if (
        !isRecord(value) ||
        value.status !== 'complete' ||
        !Array.isArray(value.hits) ||
        value.hits.length > Math.ceil(frameCount / 512)
    ) {
        return null;
    }
    const hits: { sampleOffset: number; confidence: number }[] = [];
    let previous = -1;
    const candidates: readonly unknown[] = value.hits;
    for (const hit of candidates) {
        if (
            !isRecord(hit) ||
            typeof hit.sampleOffset !== 'number' ||
            !Number.isSafeInteger(hit.sampleOffset) ||
            hit.sampleOffset <= previous ||
            hit.sampleOffset >= frameCount ||
            typeof hit.confidence !== 'number' ||
            !Number.isFinite(hit.confidence) ||
            hit.confidence < 0 ||
            hit.confidence > 1
        ) {
            return null;
        }
        hits.push({ sampleOffset: hit.sampleOffset, confidence: hit.confidence });
        previous = hit.sampleOffset;
    }
    return { status: 'complete', hits };
}

/** Transfers only caller-owned PCM copies; every terminal outcome destroys this job's Worker. */
export function runTransientOnsetWorker(
    input: TransientOnsetWorkerRequest & {
        signal?: AbortSignal;
        timeoutMs: number;
    }
): Promise<TransientOnsetWorkerResult> {
    if (input.signal?.aborted) {
        return Promise.resolve({ status: 'failed', code: 'cancelled' });
    }
    return new Promise((resolve) => {
        const frameCount = input.channels[0]?.length ?? 0;
        let worker: Worker;
        try {
            worker = new Worker(new URL('../workers/transientOnsetWorker.ts', import.meta.url), { type: 'module' });
        } catch {
            resolve({ status: 'failed', code: 'analysis-failed' });
            return;
        }
        let settled = false;
        const finish = (result: TransientOnsetWorkerResult): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            input.signal?.removeEventListener('abort', abort);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
            resolve(result);
        };
        const abort = (): void => finish({ status: 'failed', code: 'cancelled' });
        const timer = setTimeout(() => finish({ status: 'failed', code: 'analysis-timed-out' }), input.timeoutMs);
        worker.onmessage = (event: MessageEvent<unknown>): void => {
            finish(readHits(event.data, frameCount) ?? { status: 'failed', code: 'analysis-failed' });
        };
        worker.onerror = (): void => finish({ status: 'failed', code: 'analysis-failed' });
        worker.onmessageerror = (): void => finish({ status: 'failed', code: 'analysis-failed' });
        input.signal?.addEventListener('abort', abort, { once: true });
        if (input.signal?.aborted) {
            abort();
            return;
        }
        try {
            const transfer: Transferable[] = [];
            for (const channel of input.channels) {
                if (!(channel.buffer instanceof ArrayBuffer)) {
                    finish({ status: 'failed', code: 'analysis-failed' });
                    return;
                }
                transfer.push(channel.buffer);
            }
            worker.postMessage(
                { channels: input.channels, sampleRate: input.sampleRate, sensitivity: input.sensitivity },
                transfer
            );
        } catch {
            finish({ status: 'failed', code: 'analysis-failed' });
        }
    });
}
