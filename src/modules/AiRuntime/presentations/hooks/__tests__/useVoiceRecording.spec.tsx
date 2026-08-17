import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { voiceStatusStore } from '../../../stores/voiceStatusStore';
import { useVoiceRecording } from '../useVoiceRecording';

type MockVoiceInputMode = 'browser' | 'whisper' | null;
type MockResolveVoiceInputModeInput = {
    browserMode?: 'allowed' | 'disabled';
};
type MockDictationResult = {
    text: string;
    durationMs: number;
};
type MockDictationError = {
    message: string;
};
type MockVoiceStatus = {
    isListening: boolean;
    transcribing: boolean;
};

const mocks = vi.hoisted(() => ({
    onVoiceToggle: vi.fn<() => () => void>(() => () => {}),
    resolveVoiceInputMode: vi.fn<(input?: MockResolveVoiceInputModeInput) => MockVoiceInputMode>(() => null),
    injectPromptCommand: vi.fn<(text: string) => void>(),
    ensureWhisperReady: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startDictation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopDictation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setVoiceStatus: vi.fn<(status: MockVoiceStatus) => MockVoiceStatus>(),
    setVoiceListeningStatus: vi.fn<(isListening: boolean) => MockVoiceStatus>(),
    setVoiceTranscribingStatus: vi.fn<(transcribing: boolean) => MockVoiceStatus>(),
    onDictationResult: vi
        .fn<(handler: (result: MockDictationResult) => void) => Promise<() => void>>()
        .mockResolvedValue(() => {}),
    onDictationError: vi
        .fn<(handler: (error: MockDictationError) => void) => Promise<() => void>>()
        .mockResolvedValue(() => {}),
}));

vi.mock('../../../useCases/voiceToggle/onVoiceToggle', () => ({
    onVoiceToggle: mocks.onVoiceToggle,
}));

vi.mock('../../../useCases/voiceInput/resolveVoiceInputMode', () => ({
    resolveVoiceInputMode: mocks.resolveVoiceInputMode,
}));

vi.mock('../../../useCases/promptInjection', () => ({
    injectPromptCommand: mocks.injectPromptCommand,
}));

vi.mock('../../../useCases/voiceDictation/ensureWhisperReady', () => ({
    ensureWhisperReady: mocks.ensureWhisperReady,
}));

vi.mock('../../../useCases/voiceDictation/startDictation', () => ({
    startDictation: mocks.startDictation,
}));

vi.mock('../../../useCases/voiceDictation/stopDictation', () => ({
    stopDictation: mocks.stopDictation,
}));

vi.mock('../../../useCases/voiceDictation/onDictationResult', () => ({
    onDictationResult: mocks.onDictationResult,
}));

vi.mock('../../../useCases/voiceDictation/onDictationError', () => ({
    onDictationError: mocks.onDictationError,
}));

vi.mock('../../../useCases/setVoiceStatus', async () => {
    const actual = await vi.importActual<typeof import('../../../useCases/setVoiceStatus')>(
        '../../../useCases/setVoiceStatus'
    );
    mocks.setVoiceStatus.mockImplementation((status) => {
        return actual.setVoiceStatus(status);
    });
    return {
        setVoiceStatus: mocks.setVoiceStatus,
    };
});

vi.mock('../../../useCases/setVoiceListeningStatus', async () => {
    const actual = await vi.importActual<typeof import('../../../useCases/setVoiceListeningStatus')>(
        '../../../useCases/setVoiceListeningStatus'
    );
    mocks.setVoiceListeningStatus.mockImplementation((isListening) => {
        return actual.setVoiceListeningStatus(isListening);
    });
    return {
        setVoiceListeningStatus: mocks.setVoiceListeningStatus,
    };
});

vi.mock('../../../useCases/setVoiceTranscribingStatus', async () => {
    const actual = await vi.importActual<typeof import('../../../useCases/setVoiceTranscribingStatus')>(
        '../../../useCases/setVoiceTranscribingStatus'
    );
    mocks.setVoiceTranscribingStatus.mockImplementation((transcribing) => {
        return actual.setVoiceTranscribingStatus(transcribing);
    });
    return {
        setVoiceTranscribingStatus: mocks.setVoiceTranscribingStatus,
    };
});

type MockSpeechRecognition = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start: ReturnType<typeof vi.fn<() => void>>;
    stop: ReturnType<typeof vi.fn<() => void>>;
    abort: ReturnType<typeof vi.fn<() => void>>;
    onresult: ((event: MockSpeechRecognitionEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
};

type MockSpeechRecognitionEvent = {
    results: {
        length: number;
        [index: number]:
            | {
                  length: number;
                  isFinal: boolean;
                  [index: number]: { transcript: string } | undefined;
              }
            | undefined;
    };
};

const createSpeechRecognition = (input: { startFails: boolean } = { startFails: false }): MockSpeechRecognition => ({
    continuous: false,
    interimResults: false,
    lang: '',
    start: input.startFails
        ? vi.fn<() => void>(() => {
              throw new Error('browser start failed');
          })
        : vi.fn<() => void>(),
    stop: vi.fn<() => void>(),
    abort: vi.fn<() => void>(),
    onresult: null,
    onerror: null,
    onend: null,
});

const installSpeechRecognition = (recognition: MockSpeechRecognition): void => {
    const SpeechRecognition = vi.fn(function SpeechRecognition(): MockSpeechRecognition {
        return recognition;
    });
    Object.defineProperty(window, 'SpeechRecognition', { value: SpeechRecognition, configurable: true });
};

const createSpeechRecognitionEvent = (input: { transcript: string; isFinal: boolean }): MockSpeechRecognitionEvent => ({
    results: {
        length: 1,
        0: {
            length: 1,
            isFinal: input.isFinal,
            0: { transcript: input.transcript },
        },
    },
});

const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

describe('useVoiceRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        voiceStatusStore.set({ isListening: false, transcribing: false });
        mocks.resolveVoiceInputMode.mockReturnValue(null);
        mocks.ensureWhisperReady.mockResolvedValue(undefined);
        mocks.startDictation.mockResolvedValue(undefined);
        mocks.stopDictation.mockResolvedValue(undefined);
        mocks.onDictationResult.mockResolvedValue(() => {});
        mocks.onDictationError.mockResolvedValue(() => {});

        // Mock global window.SpeechRecognition
        Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
        Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    });

    it('initializes with default state', () => {
        const { result } = renderHook(() => useVoiceRecording());
        expect(result.current.isListening).toBe(false);
        expect(result.current.transcribing).toBe(false);
        expect(result.current.voiceMode).toBe(null);
    });

    it('falls back to Whisper native if browser SR is unavailable', async () => {
        mocks.resolveVoiceInputMode.mockReturnValue('whisper');
        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        expect(mocks.ensureWhisperReady).toHaveBeenCalled();
        expect(mocks.onDictationResult).toHaveBeenCalled();
        expect(mocks.startDictation).toHaveBeenCalled();

        expect(result.current.isListening).toBe(true);
        expect(result.current.voiceMode).toBe('whisper');
        expect(mocks.setVoiceListeningStatus).toHaveBeenCalledWith(true);
        expect(voiceStatusStore.value?.isListening).toBe(true);
    });

    it('syncs local transcribing from the status composed by the listening use case', async () => {
        voiceStatusStore.set({ isListening: false, transcribing: true });
        mocks.resolveVoiceInputMode.mockReturnValue('whisper');
        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        expect(mocks.setVoiceListeningStatus).toHaveBeenCalledWith(true);
        expect(result.current.isListening).toBe(true);
        expect(result.current.transcribing).toBe(true);
        expect(voiceStatusStore.value).toEqual({ isListening: true, transcribing: true });
    });

    it('sets error if no voice mode is available', () => {
        const { result } = renderHook(() => useVoiceRecording());

        act(() => {
            result.current.toggleListening();
        });

        expect(result.current.errorText).toContain('Voice input not available');
    });

    it('stops Whisper dictation and waits for result', async () => {
        mocks.resolveVoiceInputMode.mockReturnValue('whisper');
        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        expect(result.current.isListening).toBe(true);

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.stopListening();
        });

        expect(mocks.stopDictation).toHaveBeenCalled();
        expect(result.current.isListening).toBe(true);
        expect(result.current.transcribing).toBe(true);
        expect(mocks.setVoiceTranscribingStatus).toHaveBeenCalledWith(true);
        expect(voiceStatusStore.value?.transcribing).toBe(true);
    });

    it('releases the dictation listener on unmount before a result arrives', async () => {
        mocks.resolveVoiceInputMode.mockReturnValue('whisper');
        const unlisten = vi.fn<() => void>();
        mocks.onDictationResult.mockResolvedValueOnce(unlisten);

        const { result, unmount } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        expect(mocks.onDictationResult).toHaveBeenCalled();
        // No transcription result has arrived yet; the listener is still live.
        expect(unlisten).not.toHaveBeenCalled();

        unmount();

        // Unmounting must tear the native listener down so it cannot accumulate.
        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('should fall back to Whisper when browser start fails and native desktop voice is available', async () => {
        const recognition = createSpeechRecognition({ startFails: true });
        installSpeechRecognition(recognition);
        mocks.resolveVoiceInputMode.mockReturnValueOnce('browser').mockReturnValueOnce('whisper');

        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        expect(recognition.start).toHaveBeenCalledTimes(1);
        expect(mocks.resolveVoiceInputMode).toHaveBeenLastCalledWith({ browserMode: 'disabled' });
        expect(mocks.ensureWhisperReady).toHaveBeenCalled();
        expect(mocks.onDictationResult).toHaveBeenCalled();
        expect(mocks.startDictation).toHaveBeenCalled();
        expect(result.current.voiceMode).toBe('whisper');
        expect(voiceStatusStore.value?.isListening).toBe(true);
    });

    it('should not fall back to Whisper when browser start fails and native desktop voice is unavailable', async () => {
        const recognition = createSpeechRecognition({ startFails: true });
        installSpeechRecognition(recognition);
        mocks.resolveVoiceInputMode.mockReturnValueOnce('browser').mockReturnValueOnce(null);

        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        expect(recognition.start).toHaveBeenCalledTimes(1);
        expect(mocks.resolveVoiceInputMode).toHaveBeenLastCalledWith({ browserMode: 'disabled' });
        expect(mocks.ensureWhisperReady).not.toHaveBeenCalled();
        expect(mocks.startDictation).not.toHaveBeenCalled();
        expect(result.current.isListening).toBe(false);
    });

    it('should show microphone denial and fall back to Whisper when native desktop voice is available', async () => {
        const recognition = createSpeechRecognition();
        installSpeechRecognition(recognition);
        mocks.resolveVoiceInputMode.mockReturnValueOnce('browser').mockReturnValueOnce('whisper');

        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        await act(async () => {
            recognition.onerror?.({ error: 'not-allowed' });
            await Promise.resolve();
        });

        expect(result.current.errorText).toBe('Microphone access denied. Allow mic in browser settings.');
        expect(mocks.resolveVoiceInputMode).toHaveBeenLastCalledWith({ browserMode: 'disabled' });
        expect(mocks.ensureWhisperReady).toHaveBeenCalled();
        expect(mocks.startDictation).toHaveBeenCalled();
        expect(result.current.voiceMode).toBe('whisper');
    });

    it('should keep Whisper listening after the microphone denial message expires', async () => {
        vi.useFakeTimers();

        try {
            const recognition = createSpeechRecognition();
            installSpeechRecognition(recognition);
            mocks.resolveVoiceInputMode.mockReturnValueOnce('browser').mockReturnValueOnce('whisper');

            const { result } = renderHook(() => useVoiceRecording());

            // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
            await act(async () => {
                result.current.toggleListening();
            });

            await act(async () => {
                recognition.onerror?.({ error: 'not-allowed' });
                await flushMicrotasks();
            });

            expect(result.current.errorText).toBe('Microphone access denied. Allow mic in browser settings.');
            expect(result.current.voiceMode).toBe('whisper');
            expect(result.current.isListening).toBe(true);

            act(() => {
                vi.advanceTimersByTime(3000);
            });

            expect(result.current.errorText).toBe('');
            expect(result.current.voiceMode).toBe('whisper');
            expect(result.current.isListening).toBe(true);
            expect(voiceStatusStore.value?.isListening).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should show microphone denial without Whisper fallback when native desktop voice is unavailable', async () => {
        const recognition = createSpeechRecognition();
        installSpeechRecognition(recognition);
        mocks.resolveVoiceInputMode.mockReturnValueOnce('browser').mockReturnValueOnce(null);

        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        await act(async () => {
            recognition.onerror?.({ error: 'service-not-allowed' });
            await Promise.resolve();
        });

        expect(result.current.errorText).toBe('Microphone access denied. Allow mic in browser settings.');
        expect(mocks.resolveVoiceInputMode).toHaveBeenLastCalledWith({ browserMode: 'disabled' });
        expect(mocks.ensureWhisperReady).not.toHaveBeenCalled();
        expect(mocks.startDictation).not.toHaveBeenCalled();
        expect(result.current.voiceMode).toBe('browser');
    });

    it('should inject browser speech text when recognition ends', async () => {
        const recognition = createSpeechRecognition();
        installSpeechRecognition(recognition);
        mocks.resolveVoiceInputMode.mockReturnValue('browser');

        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        expect(result.current.isListening).toBe(true);
        expect(mocks.setVoiceListeningStatus).toHaveBeenCalledWith(true);
        expect(voiceStatusStore.value?.isListening).toBe(true);

        act(() => {
            recognition.onresult?.(createSpeechRecognitionEvent({ transcript: ' build a drum loop ', isFinal: true }));
            recognition.onend?.();
        });

        expect(mocks.injectPromptCommand).toHaveBeenCalledWith('build a drum loop');
        expect(result.current.isListening).toBe(false);
        expect(mocks.setVoiceListeningStatus).toHaveBeenLastCalledWith(false);
        expect(voiceStatusStore.value).toEqual({ isListening: false, transcribing: false });
    });

    it('should inject native dictation text when a Whisper result arrives', async () => {
        mocks.resolveVoiceInputMode.mockReturnValue('whisper');

        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        const handler = mocks.onDictationResult.mock.calls[0]?.[0];
        if (!handler) {
            throw new Error('Expected native dictation result listener to be registered');
        }

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.stopListening();
        });

        expect(voiceStatusStore.value).toEqual({ isListening: true, transcribing: true });

        act(() => {
            handler({ text: ' make the bass wider ', durationMs: 1200 });
        });

        expect(mocks.injectPromptCommand).toHaveBeenCalledWith('make the bass wider');
        expect(result.current.finalText).toBe('make the bass wider');
        expect(result.current.isListening).toBe(false);
        expect(result.current.transcribing).toBe(false);
        expect(mocks.setVoiceStatus).toHaveBeenLastCalledWith({ isListening: false, transcribing: false });
        expect(voiceStatusStore.value).toEqual({ isListening: false, transcribing: false });
    });

    it('clears transcribing without injecting text when the transcription is empty', async () => {
        mocks.resolveVoiceInputMode.mockReturnValue('whisper');

        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        const handler = mocks.onDictationResult.mock.calls[0]?.[0];
        if (!handler) {
            throw new Error('Expected native dictation result listener to be registered');
        }

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.stopListening();
        });

        act(() => {
            handler({ text: '', durationMs: 900 });
        });

        // An empty transcription must still resolve the session — nothing was
        // said, but the UI cannot be left waiting forever for a result.
        expect(mocks.injectPromptCommand).not.toHaveBeenCalled();
        expect(result.current.isListening).toBe(false);
        expect(result.current.transcribing).toBe(false);
        expect(voiceStatusStore.value).toEqual({ isListening: false, transcribing: false });
    });

    it('clears transcribing and surfaces an error when native dictation fails', async () => {
        mocks.resolveVoiceInputMode.mockReturnValue('whisper');

        const { result } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        const errorHandler = mocks.onDictationError.mock.calls[0]?.[0];
        if (!errorHandler) {
            throw new Error('Expected native dictation error listener to be registered');
        }

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.stopListening();
        });

        expect(voiceStatusStore.value).toEqual({ isListening: true, transcribing: true });

        act(() => {
            errorHandler({ message: 'Recording failed: no microphone found' });
        });

        expect(result.current.errorText).toBe('Recording failed: no microphone found');
        expect(result.current.isListening).toBe(false);
        expect(result.current.transcribing).toBe(false);
        expect(voiceStatusStore.value).toEqual({ isListening: false, transcribing: false });
    });

    it('does not strand the UI in "transcribing" if no native event ever arrives', async () => {
        vi.useFakeTimers();

        try {
            mocks.resolveVoiceInputMode.mockReturnValue('whisper');

            const { result } = renderHook(() => useVoiceRecording());

            // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
            await act(async () => {
                result.current.toggleListening();
            });

            // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
            await act(async () => {
                result.current.stopListening();
            });

            expect(result.current.transcribing).toBe(true);

            // Neither dictation-result nor dictation-error ever fires — the
            // defensive timeout is the only thing that can recover the UI.
            act(() => {
                vi.advanceTimersByTime(45_000);
            });

            expect(result.current.isListening).toBe(false);
            expect(result.current.transcribing).toBe(false);
            expect(result.current.errorText).toContain('timed out');
            expect(voiceStatusStore.value).toEqual({ isListening: false, transcribing: false });
        } finally {
            vi.useRealTimers();
        }
    });

    it('releases the dictation-error listener on unmount before an error arrives', async () => {
        mocks.resolveVoiceInputMode.mockReturnValue('whisper');
        const unlisten = vi.fn<() => void>();
        mocks.onDictationError.mockResolvedValueOnce(unlisten);

        const { result, unmount } = renderHook(() => useVoiceRecording());

        // eslint-disable-next-line @typescript-eslint/require-await -- act(async) is required by React 18 for flushing concurrent state updates
        await act(async () => {
            result.current.toggleListening();
        });

        expect(mocks.onDictationError).toHaveBeenCalled();
        expect(unlisten).not.toHaveBeenCalled();

        unmount();

        expect(unlisten).toHaveBeenCalledTimes(1);
    });
});
