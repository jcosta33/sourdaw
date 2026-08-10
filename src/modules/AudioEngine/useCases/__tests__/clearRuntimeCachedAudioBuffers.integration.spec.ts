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

    it('retains incoming resident buffers while dropping unrelated runtime state', async () => {
        const { audioBufferCache } = await import('../../stores/audioBufferCache');
        const { clearRuntimeCachedAudioBuffers } = await import('../clearRuntimeCachedAudioBuffers');
        audioBufferCache.set('shared-buffer', makeAudioBuffer(0.1));
        audioBufferCache.set('old-project-only', makeAudioBuffer(0.2));
        await flushIndexedDbTasks();

        clearRuntimeCachedAudioBuffers({ retainedIds: ['shared-buffer'] });

        expect(audioBufferCache.has('shared-buffer')).toBe(true);
        expect(audioBufferCache.has('old-project-only')).toBe(false);
    });

    it('lets a pending durable write finish after the runtime entry is cleared', async () => {
        const { audioBufferCache } = await import('../../stores/audioBufferCache');
        const { clearRuntimeCachedAudioBuffers } = await import('../clearRuntimeCachedAudioBuffers');
        const id = 'freeze-project-100-pending';
        audioBufferCache.set(id, makeAudioBuffer(0.1), { freezeProjectId: 100 });
        expect(controls.committed.has(id)).toBe(false);

        clearRuntimeCachedAudioBuffers();
        expect(audioBufferCache.has(id)).toBe(false);
        await flushIndexedDbTasks();

        expect(controls.committed.has(id)).toBe(true);
        expect(controls.committedMeta.get(id)?.freezeProjectId).toBe(100);
    });
});
