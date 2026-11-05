import {
    cacheAudioBuffer,
    getCachedAudioBuffer,
    restoreUnpinnedAudioBuffersFromIdb,
} from '#/modules/AudioEngine/useCases';

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
 * Cache the rendered buffers storage holds no audio for. A sample with stored
 * PCM keeps it, because a saved project may play that audio and a render of
 * another build can differ from it; a resident buffer is already the sample's
 * audio and an open project may hold it pinned.
 */
async function cacheChunkWithoutStoredAudio(chunk: readonly FactorySample[]): Promise<void> {
    const { absentIds, release } = await restoreUnpinnedAudioBuffersFromIdb({
        bufferIds: chunk.map((sample) => sample.id),
    });
    try {
        if (!findFactoryRoot()) {
            return;
        }
        const absent = new Set(absentIds);
        for (const sample of chunk) {
            if (absent.has(sample.id) && !getCachedAudioBuffer({ bufferId: sample.id })) {
                cacheAudioBuffer({ buffer: sample.buffer, bufferId: sample.id });
            }
        }
    } finally {
        release();
    }
}

/**
 * Register the synthesised buffers that have no stored audio under their
 * sample ids, in chunks, yielding to the event loop between chunks so the main
 * thread is not held in one unbroken stretch. Stops when the user disconnects
 * the factory root meanwhile.
 */
export async function cacheFactoryBuffers(samples: readonly FactorySample[]): Promise<void> {
    for (let i = 0; i < samples.length; i += CHUNK) {
        if (!findFactoryRoot()) {
            return;
        }
        await cacheChunkWithoutStoredAudio(samples.slice(i, i + CHUNK));
        if (i + CHUNK < samples.length) {
            await yieldToEventLoop();
        }
    }
}
