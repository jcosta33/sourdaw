import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { voiceStatusStore } from '../../../stores/voiceStatusStore';
import { useVoiceRecording } from '../useVoiceRecording';

const mocks = vi.hoisted(() => ({
    onVoiceToggle: vi.fn<() => () => void>(() => () => {}),
    isTauri: vi.fn<() => boolean>(() => false),
    injectPromptCommand: vi.fn<() => void>(),
    ensureWhisperReady: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startDictation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopDictation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onDictationResult: vi.fn<() => Promise<() => void>>().mockResolvedValue(() => {}),
    SpeechRecognition: vi.fn<() => void>(),
}));

vi.mock('../../../useCases/voiceToggle/onVoiceToggle', () => ({
    onVoiceToggle: mocks.onVoiceToggle,
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
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

describe('useVoiceRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        voiceStatusStore.set({ isListening: false, transcribing: false });

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
        mocks.isTauri.mockReturnValue(true);
        const { result } = renderHook(() => useVoiceRecording());

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
        mocks.isTauri.mockReturnValue(false); // No Tauri, no SpeechRecognition

        const { result } = renderHook(() => useVoiceRecording());

        act(() => {
            result.current.toggleListening();
        });

        expect(result.current.errorText).toContain('Voice input not available');
    });

    it('stops Whisper dictation and waits for result', async () => {
        mocks.isTauri.mockReturnValue(true);
        const { result } = renderHook(() => useVoiceRecording());

        await act(async () => {
            result.current.toggleListening();
        });

        expect(result.current.isListening).toBe(true);

        await act(async () => {
            result.current.stopListening();
        });

        expect(mocks.stopDictation).toHaveBeenCalled();
        expect(result.current.transcribing).toBe(true);
        expect(voiceStatusStore.value?.transcribing).toBe(true);
    });
});
