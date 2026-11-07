import { type RenderedFactorySample } from '../models/RenderedFactorySample';
import { runFactorySynthesisWorker } from '../repositories/factorySynthesisWorkerClient';
import { toAudioBuffer } from '../services/bufferCreation';

import { type FactorySample } from './types';

const RENDER_TIMEOUT_MS = 30_000;
const BUFFERS_PER_CHUNK = 8;

function toFactorySample(ctx: AudioContext, rendered: RenderedFactorySample): FactorySample {
    const { channels, sampleRate, ...metadata } = rendered;
    return { ...metadata, buffer: toAudioBuffer(ctx, { channels, sampleRate }) };
}

function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * Synthesizes the factory library in a Worker, then builds its AudioBuffers on
 * the main thread in chunks so no single task holds the thread for long.
 */
export async function renderFactorySamples(ctx: AudioContext): Promise<FactorySample[]> {
    const result = await runFactorySynthesisWorker({ timeoutMs: RENDER_TIMEOUT_MS });
    if (result.status === 'failed') {
        throw new Error(`Factory sample synthesis failed in its worker (${result.code})`);
    }
    const samples: FactorySample[] = [];
    for (let start = 0; start < result.samples.length; start += BUFFERS_PER_CHUNK) {
        if (start > 0) {
            await yieldToEventLoop();
        }
        for (const rendered of result.samples.slice(start, start + BUFFERS_PER_CHUNK)) {
            samples.push(toFactorySample(ctx, rendered));
        }
    }
    return samples;
}
