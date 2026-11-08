import { afterEach, describe, expect, it } from 'vitest';

import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { isAudioBufferHeld } from '#/modules/AudioEngine/stores/audioBufferResidencyHolds';

import { registerBrowserImportedSampleAudio } from '../registerBrowserImportedSampleAudio';

const CACHE_CAPACITY = 64;

function bufferAt(index: number): AudioBuffer {
    return {
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
        duration: index,
        getChannelData: () => new Float32Array(1),
        length: 1,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

/** Flood the LRU cache so only held ids survive eviction pressure. */
function floodCache(): void {
    for (let index = 0; index < CACHE_CAPACITY; index++) {
        audioBufferCache.set(`flood-${index}`, bufferAt(index));
    }
}

describe('registerBrowserImportedSampleAudio', () => {
    afterEach(() => {
        audioBufferCache.clear();
    });

    it('keeps a registered import buffer resident when the cache is under eviction pressure', () => {
        const importedId = 'browser-imported';
        audioBufferCache.set(importedId, bufferAt(0.5));
        registerBrowserImportedSampleAudio(importedId);
        expect(isAudioBufferHeld(importedId)).toBe(true);

        floodCache();
        expect(audioBufferCache.has(importedId)).toBe(true);
    });
});
