import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    BUFFER_STORE,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
} from '../../stores/__tests__/fakeAudioBufferIndexedDb';

let audioBufferCache: typeof import('../../stores/audioBufferCache').audioBufferCache;
let discardDecodedAudioFile: typeof import('../discardDecodedAudioFile').discardDecodedAudioFile;
let setDurableAudioBufferOwnershipProvider: typeof import('../../stores/durableAudioBufferOwnership').setDurableAudioBufferOwnershipProvider;
let lockManager: ReturnType<typeof createControlledLockManager>;

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
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
        [{ audioBufferCache }, { discardDecodedAudioFile }, { setDurableAudioBufferOwnershipProvider }] =
            await Promise.all([
                import('../../stores/audioBufferCache'),
                import('../discardDecodedAudioFile'),
                import('../../stores/durableAudioBufferOwnership'),
            ]);
        setDurableAudioBufferOwnershipProvider(() => Promise.resolve([]));
    });

    afterEach(async () => {
        audioBufferCache.clear();
        await lockManager.locks.request('sourdaw:project-audio-storage', { mode: 'exclusive' }, async () => undefined);
        setDurableAudioBufferOwnershipProvider(null);
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

        const initialDurability = await audioBufferCache.ensureDurable(['audio-discarded', 'audio-retained']);
        expect(initialDurability.status).toBe('durable');
        if (initialDurability.status === 'durable') {
            initialDurability.release();
        }

        discardDecodedAudioFile('audio-discarded');

        expect(audioBufferCache.has('audio-discarded')).toBe(false);
        expect(audioBufferCache.get('audio-retained')).toBe(retained);
        await lockManager.locks.request('sourdaw:project-audio-storage', { mode: 'exclusive' }, async () => undefined);
        await vi.waitFor(() => {
            expect(controls.committed.has('audio-discarded')).toBe(false);
            expect(controls.committedMeta.has('audio-discarded')).toBe(false);
        });
        expect(controls.committed.has('audio-retained')).toBe(true);
        expect(controls.committedMeta.has('audio-retained')).toBe(true);
        const retainedDurability = await audioBufferCache.ensureDurable(['audio-retained']);
        expect(retainedDurability.status).toBe('durable');
        if (retainedDurability.status === 'durable') {
            retainedDurability.release();
        }
    });
});
