import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { findFactoryRoot } from './findFactoryRoot';
import { type FactorySample } from './toFactorySampleRecord';

const CHUNK = 16;

/** Yield to the event loop so the main thread can paint between chunks. */
function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * A resident buffer is already the sample's audio, and an open project may hold
 * it pinned, so a render never replaces it or rewrites its stored PCM.
 */
function cacheUnlessResident(sample: FactorySample): void {
    if (getCachedAudioBuffer({ bufferId: sample.id })) {
        return;
    }
    cacheAudioBuffer({ buffer: sample.buffer, bufferId: sample.id });
}

/**
 * Register the synthesised buffers under their sample ids, in chunks, yielding
 * to the event loop between chunks so the main thread is not held in one
 * unbroken stretch while the whole pack is cached. Stops when the user
 * disconnects the factory root during a yield.
 */
export async function cacheFactoryBuffers(samples: readonly FactorySample[]): Promise<void> {
    for (let i = 0; i < samples.length; i += CHUNK) {
        if (!findFactoryRoot()) {
            return;
        }
        samples.slice(i, i + CHUNK).forEach(cacheUnlessResident);
        if (i + CHUNK < samples.length) {
            await yieldToEventLoop();
        }
    }
}
