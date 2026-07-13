import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';

import { restoreCachedAudioBuffersFromIdb } from '../restoreCachedAudioBuffersFromIdb';

const mocks = vi.hoisted(() => ({
    restoreFromIdb: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        restoreFromIdb: mocks.restoreFromIdb,
    },
}));

describe('restoreCachedAudioBuffersFromIdb', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.restoreFromIdb.mockResolvedValue(0);
    });

    it('should restore all cached buffers from IndexedDB when buffer ids are omitted', async () => {
        const audio_context = asBaseAudioContext(createMockAudioContext());
        mocks.restoreFromIdb.mockResolvedValue(3);

        const restored_count = await restoreCachedAudioBuffersFromIdb({ audioContext: audio_context });

        expect(restored_count).toBe(3);
        expect(mocks.restoreFromIdb).toHaveBeenCalledWith({
            context: audio_context,
            ids: undefined,
            shouldContinue: undefined,
        });
    });

    it('should restore only the requested cached buffer ids from IndexedDB', async () => {
        const audio_context = asBaseAudioContext(createMockAudioContext());
        const buffer_ids = ['clip-buffer-1', 'frozen-buffer-2'];
        mocks.restoreFromIdb.mockResolvedValue(2);

        const restored_count = await restoreCachedAudioBuffersFromIdb({
            audioContext: audio_context,
            bufferIds: buffer_ids,
        });

        expect(restored_count).toBe(2);
        expect(mocks.restoreFromIdb).toHaveBeenCalledWith({
            context: audio_context,
            ids: buffer_ids,
            shouldContinue: undefined,
        });
    });

    it('forwards the transition guard to the cache owner', async () => {
        const audio_context = asBaseAudioContext(createMockAudioContext());
        const should_continue = vi.fn(() => true);

        await restoreCachedAudioBuffersFromIdb({
            audioContext: audio_context,
            shouldContinue: should_continue,
        });

        expect(mocks.restoreFromIdb).toHaveBeenCalledWith({
            context: audio_context,
            ids: undefined,
            shouldContinue: should_continue,
        });
    });
});
