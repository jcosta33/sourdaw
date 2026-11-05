import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';

import { type FactorySample } from './toFactorySampleRecord';

const CHUNK = 16;

/** Yield to the event loop so the main thread can paint between chunks. */
function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * Register the synthesised buffers under their sample ids, in chunks, yielding
 * to the event loop between chunks so the main thread is not held in one
 * unbroken stretch while the whole pack is cached.
 */
export async function cacheFactoryBuffers(samples: readonly FactorySample[]): Promise<void> {
    for (let i = 0; i < samples.length; i += CHUNK) {
        const end = Math.min(i + CHUNK, samples.length);
        for (let j = i; j < end; j++) {
            cacheAudioBuffer({ buffer: samples[j]!.buffer, bufferId: samples[j]!.id });
        }
        if (end < samples.length) {
            await yieldToEventLoop();
        }
    }
}
