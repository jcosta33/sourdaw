import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    type FakeAudioIndexedDbControls,
} from '../../stores/__tests__/fakeAudioBufferIndexedDb';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

function makeAudioBuffer(value: number): AudioBuffer {
    const channel = new Float32Array([value]);
    return {
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
        duration: 1 / 48_000,
        getChannelData: () => channel,
        length: channel.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

describe('clearRuntimeCachedAudioBuffers', () => {
    let controls: FakeAudioIndexedDbControls;

    beforeEach(() => {
        vi.resetModules();
        controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE] });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('drops resident buffers without deleting either project from IndexedDB', async () => {
        const { audioBufferCache } = await import('../../stores/audioBufferCache');
        const { clearRuntimeCachedAudioBuffers } = await import('../clearRuntimeCachedAudioBuffers');
        const projectAId = 'freeze-project-100-track-a';
        const projectBId = 'freeze-project-200-track-b';
        audioBufferCache.set(projectAId, makeAudioBuffer(0.1), { freezeProjectId: 100 });
        audioBufferCache.set(projectBId, makeAudioBuffer(0.2), { freezeProjectId: 200 });
        await flushIndexedDbTasks();

        clearRuntimeCachedAudioBuffers();
        await flushIndexedDbTasks();

        expect(audioBufferCache.has(projectAId)).toBe(false);
        expect(audioBufferCache.has(projectBId)).toBe(false);
        expect([...controls.committed.keys()].sort()).toEqual([projectAId, projectBId]);
        expect(controls.committedMeta.get(projectAId)?.freezeProjectId).toBe(100);
        expect(controls.committedMeta.get(projectBId)?.freezeProjectId).toBe(200);
    });
});
