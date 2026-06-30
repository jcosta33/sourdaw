import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isBrowserSpeechRecognitionAvailable } from '../../../repositories/voiceInput/isBrowserSpeechRecognitionAvailable';
import { isNativeVoiceInputAvailable } from '../../../repositories/voiceInput/isNativeVoiceInputAvailable';
import { resolveVoiceInputMode } from '../resolveVoiceInputMode';

vi.mock('../../../repositories/voiceInput/isBrowserSpeechRecognitionAvailable', () => ({
    isBrowserSpeechRecognitionAvailable: vi.fn(),
}));

vi.mock('../../../repositories/voiceInput/isNativeVoiceInputAvailable', () => ({
    isNativeVoiceInputAvailable: vi.fn(),
}));

describe('resolveVoiceInputMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isBrowserSpeechRecognitionAvailable).mockReturnValue(false);
        vi.mocked(isNativeVoiceInputAvailable).mockReturnValue(false);
    });

    it('should prefer browser speech recognition when it is available', () => {
        vi.mocked(isBrowserSpeechRecognitionAvailable).mockReturnValue(true);
        vi.mocked(isNativeVoiceInputAvailable).mockReturnValue(true);

        expect(resolveVoiceInputMode()).toBe('browser');
        expect(isNativeVoiceInputAvailable).not.toHaveBeenCalled();
    });

    it('should use Whisper when browser speech recognition is unavailable and native desktop voice is available', () => {
        vi.mocked(isNativeVoiceInputAvailable).mockReturnValue(true);

        expect(resolveVoiceInputMode()).toBe('whisper');
    });

    it('should return null when neither browser speech nor native desktop voice input is available', () => {
        expect(resolveVoiceInputMode()).toBeNull();
    });

    it('should resolve Whisper for browser fallback only when native desktop voice is available', () => {
        vi.mocked(isBrowserSpeechRecognitionAvailable).mockReturnValue(true);
        vi.mocked(isNativeVoiceInputAvailable).mockReturnValue(true);

        expect(resolveVoiceInputMode({ browserMode: 'disabled' })).toBe('whisper');
        expect(isBrowserSpeechRecognitionAvailable).not.toHaveBeenCalled();
    });

    it('should return null for browser fallback when native desktop voice is unavailable', () => {
        vi.mocked(isBrowserSpeechRecognitionAvailable).mockReturnValue(true);

        expect(resolveVoiceInputMode({ browserMode: 'disabled' })).toBeNull();
        expect(isBrowserSpeechRecognitionAvailable).not.toHaveBeenCalled();
    });
});
