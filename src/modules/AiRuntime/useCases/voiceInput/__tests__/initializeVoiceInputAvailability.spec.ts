import { beforeEach, describe, expect, it, vi } from 'vitest';

import { voiceInputAvailabilityStore } from '../../../stores/voiceInputAvailabilityStore';
import { voiceModelSetupStore } from '../../../stores/voiceModelSetupStore';
import { initializeVoiceInputAvailability } from '../initializeVoiceInputAvailability';

const mocks = vi.hoisted(() => ({
    loadCachedWhisperModel: vi.fn<() => Promise<void>>(),
    isDesktopRuntime: vi.fn<() => boolean>(),
}));

vi.mock('../../voiceDictation/loadCachedWhisperModel', () => ({
    loadCachedWhisperModel: mocks.loadCachedWhisperModel,
}));

vi.mock('#/utils/desktopRuntime', () => ({
    isDesktopRuntime: mocks.isDesktopRuntime,
}));

describe('initializeVoiceInputAvailability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isDesktopRuntime.mockReturnValue(true);
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });
        voiceModelSetupStore.set({ state: 'error', message: 'sentinel' });
    });

    it('makes local voice available only after lifecycle cache verification succeeds', async () => {
        mocks.loadCachedWhisperModel.mockResolvedValue(undefined);

        await initializeVoiceInputAvailability();

        expect(mocks.loadCachedWhisperModel).toHaveBeenCalledOnce();
        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: true });
    });

    it('leaves the setup store untouched when the cached load succeeds', async () => {
        mocks.loadCachedWhisperModel.mockResolvedValue(undefined);

        await initializeVoiceInputAvailability();

        expect(voiceModelSetupStore.value).toEqual({ state: 'error', message: 'sentinel' });
    });

    it('keeps local voice unavailable when no verified cached model exists', async () => {
        mocks.loadCachedWhisperModel.mockRejectedValue(new Error('not cached'));

        await initializeVoiceInputAvailability();

        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: false });
    });

    it('marks the model missing on desktop so the download affordance can retry', async () => {
        mocks.loadCachedWhisperModel.mockRejectedValue(new Error('not cached'));

        await initializeVoiceInputAvailability();

        expect(voiceModelSetupStore.value).toEqual({ state: 'missing' });
    });

    it('offers no setup affordance off the desktop runtime', async () => {
        mocks.isDesktopRuntime.mockReturnValue(false);
        mocks.loadCachedWhisperModel.mockRejectedValue(new Error('not cached'));

        await initializeVoiceInputAvailability();

        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: false });
        expect(voiceModelSetupStore.value).toEqual({ state: 'error', message: 'sentinel' });
    });
});
