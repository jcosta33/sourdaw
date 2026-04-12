import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceRecording } from '../useVoiceRecording';
import { voiceStatusStore } from '../../../stores/voiceStatusStore';

const mocks = vi.hoisted(() => ({
    onVoiceToggle: vi.fn(() => () => {}),
    isTauri: vi.fn(() => false),
    injectPromptCommand: vi.fn(),
    ensureWhisperReady: vi.fn().mockResolvedValue(undefined),
    startDictation: vi.fn().mockResolvedValue(undefined),
    stopDictation: vi.fn().mockResolvedValue(undefined),
    onDictationResult: vi.fn().mockResolvedValue(() => {}),
    SpeechRecognition: vi.fn(),
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
        (window as any).SpeechRecognition = undefined;
        (window as any).webkitSpeechRecognition = undefined;
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
