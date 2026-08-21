import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { voiceInputAvailabilityStore } from '../../../stores/voiceInputAvailabilityStore';
import { useVoiceRecording } from '../useVoiceRecording';

const mocks = vi.hoisted(() => ({
    onVoiceToggle: vi.fn<(handler: (payload: { gesture?: unknown }) => void) => () => void>(() => () => {}),
    startDictation: vi.fn<(sessionId: string) => Promise<string>>(async (sessionId) => sessionId),
    stopDictation: vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined),
    cancelDictation: vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined),
    onDictationResult: vi
        .fn<
            (
                sessionId: string,
                handler: (result: { sessionId: string; text: string; durationMs: number }) => void
            ) => () => void
        >()
        .mockReturnValue(() => {}),
    onDictationError: vi
        .fn<(sessionId: string, handler: (error: { sessionId: string; message: string }) => void) => () => void>()
        .mockReturnValue(() => {}),
    consume: vi.fn<(value: unknown) => boolean>(() => false),
    setVoiceStatus: vi.fn((value: { isListening: boolean; transcribing: boolean }) => value),
}));

vi.mock('../../../useCases/voiceToggle/onVoiceToggle', () => ({ onVoiceToggle: mocks.onVoiceToggle }));
vi.mock('../../../useCases/voiceDictation/startDictation', () => ({ startDictation: mocks.startDictation }));
vi.mock('../../../useCases/voiceDictation/stopDictation', () => ({ stopDictation: mocks.stopDictation }));
vi.mock('../../../useCases/voiceDictation/cancelDictation', () => ({ cancelDictation: mocks.cancelDictation }));
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
        mocks.consume.mockReturnValue(false);
        mocks.startDictation.mockImplementation(async (sessionId) => sessionId);
        mocks.stopDictation.mockResolvedValue(undefined);
        mocks.cancelDictation.mockResolvedValue(undefined);
        mocks.onDictationResult.mockReturnValue(() => {});
        mocks.onDictationError.mockReturnValue(() => {});
        mocks.setVoiceStatus.mockImplementation((value) => value);
    });

    it('does not let presentation mount write shared voice availability', async () => {
        renderHook(() => useVoiceRecording());
        await act(async () => {});

        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: false });
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
        let resultListener: ((result: { sessionId: string; text: string; durationMs: number }) => void) | undefined;
        let errorListener: ((error: { sessionId: string; message: string }) => void) | undefined;
        mocks.consume.mockReturnValue(true);
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });
        mocks.onVoiceToggle.mockImplementation((handler) => {
            toggleListener = handler;
            return () => {};
        });
        mocks.onDictationResult.mockImplementation((_sessionId, handler) => {
            resultListener = handler;
            return () => {};
        });
        mocks.onDictationError.mockImplementation((_sessionId, handler) => {
            errorListener = handler;
            return () => {};
        });
        renderHook(() => useVoiceRecording());
        await act(async () => {});

        await act(async () => toggleListener?.({ gesture: {} }));
        const sessionId = mocks.startDictation.mock.calls[0]?.[0];
        expect(sessionId).toBeDefined();
        await act(async () => {
            resultListener?.({ sessionId: sessionId ?? '', text: '', durationMs: 1 });
            errorListener?.({ sessionId: sessionId ?? '', message: 'late native failure' });
        });

        expect(mocks.setVoiceStatus).toHaveBeenCalledTimes(1);
    });

    it('does not reanimate listening when a terminal error arrives before the start acknowledgement', async () => {
        let toggleListener: ((payload: { gesture?: unknown }) => void) | undefined;
        let errorListener: ((error: { sessionId: string; message: string }) => void) | undefined;
        let acknowledge: ((sessionId: string) => void) | undefined;
        mocks.consume.mockReturnValue(true);
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });
        mocks.onVoiceToggle.mockImplementation((handler) => {
            toggleListener = handler;
            return () => {};
        });
        mocks.onDictationError.mockImplementation((_sessionId, handler) => {
            errorListener = handler;
            return () => {};
        });
        mocks.startDictation.mockImplementation(
            (sessionId) => new Promise((resolve) => (acknowledge = () => resolve(sessionId)))
        );
        const { result } = renderHook(() => useVoiceRecording());
        await act(async () => {});

        await act(async () => toggleListener?.({ gesture: {} }));
        const sessionId = mocks.startDictation.mock.calls[0]?.[0];
        if (sessionId === undefined) {
            throw new Error('dictation start was not called');
        }
        await act(async () => errorListener?.({ sessionId, message: 'microphone failed' }));
        await act(async () => acknowledge?.(sessionId));

        expect(result.current.isListening).toBe(false);
        expect(result.current.transcribing).toBe(false);
        expect(mocks.setVoiceStatus).toHaveBeenCalledTimes(1);
    });

    it('cancels the active session on timeout and emits no second terminal transition', async () => {
        vi.useFakeTimers();
        let toggleListener: ((payload: { gesture?: unknown }) => void) | undefined;
        mocks.consume.mockReturnValue(true);
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });
        mocks.onVoiceToggle.mockImplementation((handler) => {
            toggleListener = handler;
            return () => {};
        });
        const { result } = renderHook(() => useVoiceRecording());
        await act(async () => {});

        await act(async () => toggleListener?.({ gesture: {} }));
        const sessionId = mocks.startDictation.mock.calls[0]?.[0];
        if (sessionId === undefined) {
            throw new Error('dictation start was not called');
        }
        await act(async () => {});
        await act(async () => vi.advanceTimersByTimeAsync(45_000));

        expect(mocks.cancelDictation).toHaveBeenCalledWith(sessionId);
        expect(result.current.isListening).toBe(false);
        expect(mocks.setVoiceStatus).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('cancels an unmounted session and ignores its terminal event after remount', async () => {
        let toggleListener: ((payload: { gesture?: unknown }) => void) | undefined;
        const resultListeners: Array<(result: { sessionId: string; text: string; durationMs: number }) => void> = [];
        mocks.consume.mockReturnValue(true);
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });
        mocks.onVoiceToggle.mockImplementation((handler) => {
            toggleListener = handler;
            return () => {};
        });
        mocks.onDictationResult.mockImplementation((_sessionId, handler) => {
            resultListeners.push(handler);
            return () => {};
        });
        const first = renderHook(() => useVoiceRecording());
        await act(async () => {});
        await act(async () => toggleListener?.({ gesture: {} }));
        const firstSession = mocks.startDictation.mock.calls[0]?.[0];
        if (firstSession === undefined) {
            throw new Error('first dictation start was not called');
        }
        first.unmount();
        expect(mocks.cancelDictation).toHaveBeenCalledWith(firstSession);

        const second = renderHook(() => useVoiceRecording());
        await act(async () => {});
        await act(async () => toggleListener?.({ gesture: {} }));
        const secondSession = mocks.startDictation.mock.calls[1]?.[0];
        if (secondSession === undefined) {
            throw new Error('second dictation start was not called');
        }
        await act(async () => resultListeners[0]?.({ sessionId: firstSession, text: 'old', durationMs: 1 }));

        expect(second.result.current.finalText).toBe('');
        expect(secondSession).not.toBe(firstSession);
    });
});
