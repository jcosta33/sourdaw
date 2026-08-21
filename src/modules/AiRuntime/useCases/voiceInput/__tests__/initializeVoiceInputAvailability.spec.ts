import { beforeEach, describe, expect, it, vi } from 'vitest';

import { voiceInputAvailabilityStore } from '../../../stores/voiceInputAvailabilityStore';
import { initializeVoiceInputAvailability } from '../initializeVoiceInputAvailability';

const mocks = vi.hoisted(() => ({
    loadCachedWhisperModel: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../voiceDictation/loadCachedWhisperModel', () => ({
    loadCachedWhisperModel: mocks.loadCachedWhisperModel,
}));

describe('initializeVoiceInputAvailability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });
    });

    it('makes local voice available only after lifecycle cache verification succeeds', async () => {
        mocks.loadCachedWhisperModel.mockResolvedValue(undefined);

        await initializeVoiceInputAvailability();

        expect(mocks.loadCachedWhisperModel).toHaveBeenCalledOnce();
        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: true });
    });

    it('keeps local voice unavailable when no verified cached model exists', async () => {
        mocks.loadCachedWhisperModel.mockRejectedValue(new Error('not cached'));

        await initializeVoiceInputAvailability();

        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: false });
    });
});
