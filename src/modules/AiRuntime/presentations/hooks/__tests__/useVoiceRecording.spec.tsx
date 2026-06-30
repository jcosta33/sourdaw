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

const mocks = vi.hoisted(() => ({
    onVoiceToggle: vi.fn<() => () => void>(() => () => {}),
    resolveVoiceInputMode: vi.fn<(input?: MockResolveVoiceInputModeInput) => MockVoiceInputMode>(() => null),
    injectPromptCommand: vi.fn<(text: string) => void>(),
    ensureWhisperReady: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startDictation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopDictation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onDictationResult: vi
        .fn<(handler: (result: MockDictationResult) => void) => Promise<() => void>>()
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
        expect(voiceStatusStore.value?.isListening).toBe(true);
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
        expect(result.current.transcribing).toBe(true);
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

        act(() => {
            recognition.onresult?.(createSpeechRecognitionEvent({ transcript: ' build a drum loop ', isFinal: true }));
            recognition.onend?.();
        });

        expect(mocks.injectPromptCommand).toHaveBeenCalledWith('build a drum loop');
        expect(result.current.isListening).toBe(false);
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

        act(() => {
            handler({ text: ' make the bass wider ', durationMs: 1200 });
        });

        expect(mocks.injectPromptCommand).toHaveBeenCalledWith('make the bass wider');
        expect(result.current.finalText).toBe('make the bass wider');
        expect(result.current.isListening).toBe(false);
    });
});
