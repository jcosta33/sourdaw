import {
    type FactorySynthesisWorkerRequest,
    type FactorySynthesisWorkerResult,
} from '../models/FactorySynthesisWorker';
import { type FactorySampleCategory, type RenderedFactorySample } from '../models/RenderedFactorySample';

const MAX_FACTORY_SAMPLES = 512;
const MAX_CHANNELS = 2;
const CATEGORIES: readonly FactorySampleCategory[] = ['drums', 'bass', 'keys', 'vocal-loop', 'fx'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCategory(value: unknown): value is FactorySampleCategory {
    return CATEGORIES.some((category) => category === value);
}

function isOptionalFinite(value: unknown): value is number | undefined {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function readChannels(value: unknown): Float32Array[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHANNELS) {
        return null;
    }
    const channels: Float32Array[] = [];
    const candidates: readonly unknown[] = value;
    for (const channel of candidates) {
        if (!(channel instanceof Float32Array) || channel.length === 0) {
            return null;
        }
        if (channels.length > 0 && channel.length !== channels[0]?.length) {
            return null;
        }
        channels.push(channel);
    }
    return channels;
}

function readSample(value: unknown): RenderedFactorySample | null {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        value.id.length === 0 ||
        typeof value.name !== 'string' ||
        !isCategory(value.category) ||
        !Array.isArray(value.tags) ||
        !value.tags.every((tag: unknown) => typeof tag === 'string') ||
        !isOptionalFinite(value.bpm) ||
        !isOptionalFinite(value.pitch) ||
        typeof value.sampleRate !== 'number' ||
        !Number.isFinite(value.sampleRate) ||
        value.sampleRate <= 0
    ) {
        return null;
    }
    const channels = readChannels(value.channels);
    if (channels === null) {
        return null;
    }
    const tags: string[] = [...value.tags];
    return {
        id: value.id,
        name: value.name,
        category: value.category,
        tags,
        bpm: value.bpm,
        pitch: value.pitch,
        channels,
        sampleRate: value.sampleRate,
    };
}

function readReply(value: unknown): Extract<FactorySynthesisWorkerResult, { status: 'complete' }> | null {
    if (
        !isRecord(value) ||
        value.status !== 'complete' ||
        !Array.isArray(value.samples) ||
        value.samples.length === 0 ||
        value.samples.length > MAX_FACTORY_SAMPLES
    ) {
        return null;
    }
    const samples: RenderedFactorySample[] = [];
    const ids = new Set<string>();
    const candidates: readonly unknown[] = value.samples;
    for (const candidate of candidates) {
        const sample = readSample(candidate);
        if (sample === null || ids.has(sample.id)) {
            return null;
        }
        ids.add(sample.id);
        samples.push(sample);
    }
    return { status: 'complete', samples };
}

/** Renders the factory library in a dedicated Worker; every terminal outcome destroys that Worker. */
export function runFactorySynthesisWorker(input: { timeoutMs: number }): Promise<FactorySynthesisWorkerResult> {
    return new Promise((resolve) => {
        let worker: Worker;
        try {
            worker = new Worker(new URL('../workers/factorySynthesisWorker.ts', import.meta.url), { type: 'module' });
        } catch {
            resolve({ status: 'failed', code: 'render-failed' });
            return;
        }
        let settled = false;
        const finish = (result: FactorySynthesisWorkerResult): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
            resolve(result);
        };
        const timer = setTimeout(() => finish({ status: 'failed', code: 'render-timed-out' }), input.timeoutMs);
        worker.onmessage = (event: MessageEvent<unknown>): void => {
            finish(readReply(event.data) ?? { status: 'failed', code: 'render-failed' });
        };
        worker.onerror = (): void => finish({ status: 'failed', code: 'render-failed' });
        worker.onmessageerror = (): void => finish({ status: 'failed', code: 'render-failed' });
        try {
            const request: FactorySynthesisWorkerRequest = { type: 'render' };
            worker.postMessage(request);
        } catch {
            finish({ status: 'failed', code: 'render-failed' });
        }
    });
}
