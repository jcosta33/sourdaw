import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { voiceInputAvailabilityStore } from '../../../stores/voiceInputAvailabilityStore';
import { useVoiceRecording } from '../useVoiceRecording';

const mocks = vi.hoisted(() => ({
    onVoiceToggle: vi.fn<(handler: (payload: { gesture?: unknown }) => void) => () => void>(() => () => {}),
    loadCachedWhisperModel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startDictation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopDictation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onDictationResult: vi
        .fn<(handler: (result: { text: string; durationMs: number }) => void) => Promise<() => void>>()
        .mockResolvedValue(() => {}),
    onDictationError: vi
        .fn<(handler: (error: { message: string }) => void) => Promise<() => void>>()
        .mockResolvedValue(() => {}),
    consume: vi.fn<(value: unknown) => boolean>(() => false),
    setVoiceStatus: vi.fn((value: { isListening: boolean; transcribing: boolean }) => value),
}));

vi.mock('../../../useCases/voiceToggle/onVoiceToggle', () => ({ onVoiceToggle: mocks.onVoiceToggle }));
vi.mock('../../../useCases/voiceDictation/loadCachedWhisperModel', () => ({
    loadCachedWhisperModel: mocks.loadCachedWhisperModel,
}));
vi.mock('../../../useCases/voiceDictation/startDictation', () => ({ startDictation: mocks.startDictation }));
vi.mock('../../../useCases/voiceDictation/stopDictation', () => ({ stopDictation: mocks.stopDictation }));
vi.mock('../../../useCases/voiceDictation/onDictationResult', () => ({ onDictationResult: mocks.onDictationResult }));
vi.mock('../../../useCases/voiceDictation/onDictationError', () => ({ onDictationError: mocks.onDictationError }));
vi.mock('../../../useCases/voiceInput/voiceCommandGesture', () => ({
    voiceCommandGesture: { consume: mocks.consume },
}));
vi.mock('../../../useCases/setVoiceStatus', () => ({ setVoiceStatus: mocks.setVoiceStatus }));

describe('useVoiceRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });
        mocks.loadCachedWhisperModel.mockResolvedValue(undefined);
        mocks.consume.mockReturnValue(false);
        mocks.setVoiceStatus.mockImplementation((value) => value);
    });

    it('marks voice available only after the cache-only native loader succeeds', async () => {
        renderHook(() => useVoiceRecording());
        await act(async () => {});

        expect(mocks.loadCachedWhisperModel).toHaveBeenCalledOnce();
        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: true });
    });

    it('rejects a programmatic event-bus start without a consumed gesture token', async () => {
        let listener: ((payload: { gesture?: unknown }) => void) | undefined;
        mocks.onVoiceToggle.mockImplementation((handler) => {
            listener = handler;
            return () => {};
        });
        renderHook(() => useVoiceRecording());
        await act(async () => {});

        await act(async () => listener?.({ gesture: {} }));

        expect(mocks.startDictation).not.toHaveBeenCalled();
    });

    it('settles a native session once when result and error race', async () => {
        let toggleListener: ((payload: { gesture?: unknown }) => void) | undefined;
        let resultListener: ((result: { text: string; durationMs: number }) => void) | undefined;
        let errorListener: ((error: { message: string }) => void) | undefined;
        mocks.consume.mockReturnValue(true);
        mocks.onVoiceToggle.mockImplementation((handler) => {
            toggleListener = handler;
            return () => {};
        });
        mocks.onDictationResult.mockImplementation(async (handler) => {
            resultListener = handler;
            return () => {};
        });
        mocks.onDictationError.mockImplementation(async (handler) => {
            errorListener = handler;
            return () => {};
        });
        renderHook(() => useVoiceRecording());
        await act(async () => {});

        await act(async () => toggleListener?.({ gesture: {} }));
        await act(async () => {
            resultListener?.({ text: '', durationMs: 1 });
            errorListener?.({ message: 'late native failure' });
        });

        expect(mocks.setVoiceStatus).toHaveBeenCalledTimes(1);
    });
});
