import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
} from '../../stores/__tests__/fakeAudioBufferIndexedDb';

let audioBufferCache: typeof import('../../stores/audioBufferCache').audioBufferCache;
let discardDecodedAudioFile: typeof import('../discardDecodedAudioFile').discardDecodedAudioFile;

function createAudioBuffer(): AudioBuffer {
    const channel = new Float32Array([0.25, -0.25]);
    return {
        copyFromChannel: (destination: Float32Array) => destination.set(channel),
        copyToChannel: () => {},
        duration: channel.length / 48_000,
        getChannelData: () => channel,
        length: channel.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

describe('discardDecodedAudioFile', () => {
    beforeEach(async () => {
        vi.resetModules();
        ({ audioBufferCache } = await import('../../stores/audioBufferCache'));
        ({ discardDecodedAudioFile } = await import('../discardDecodedAudioFile'));
    });

    afterEach(() => {
        audioBufferCache.clear();
        vi.unstubAllGlobals();
    });

    it('removes only the decoded id from runtime and both IndexedDB stores', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE] });
        const discarded = createAudioBuffer();
        const retained = createAudioBuffer();
        audioBufferCache.set('audio-discarded', discarded);
        audioBufferCache.set('audio-retained', retained);
        await vi.waitFor(() => {
            expect(controls.committed.has('audio-discarded')).toBe(true);
            expect(controls.committedMeta.has('audio-discarded')).toBe(true);
            expect(controls.committed.has('audio-retained')).toBe(true);
            expect(controls.committedMeta.has('audio-retained')).toBe(true);
        });

        discardDecodedAudioFile('audio-discarded');

        expect(audioBufferCache.has('audio-discarded')).toBe(false);
        expect(audioBufferCache.get('audio-retained')).toBe(retained);
        await vi.waitFor(() => {
            expect(controls.committed.has('audio-discarded')).toBe(false);
            expect(controls.committedMeta.has('audio-discarded')).toBe(false);
        });
        expect(controls.committed.has('audio-retained')).toBe(true);
        expect(controls.committedMeta.has('audio-retained')).toBe(true);
        await expect(audioBufferCache.ensureDurable(['audio-retained'])).resolves.toMatchObject({ status: 'durable' });
    });
});
