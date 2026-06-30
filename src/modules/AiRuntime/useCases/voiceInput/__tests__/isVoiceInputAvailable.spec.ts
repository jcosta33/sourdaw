import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isBrowserSpeechRecognitionAvailable } from '../../../repositories/voiceInput/isBrowserSpeechRecognitionAvailable';
import { isNativeVoiceInputAvailable } from '../../../repositories/voiceInput/isNativeVoiceInputAvailable';
import { isVoiceInputAvailable } from '../isVoiceInputAvailable';

vi.mock('../../../repositories/voiceInput/isBrowserSpeechRecognitionAvailable', () => ({
    isBrowserSpeechRecognitionAvailable: vi.fn(),
}));

vi.mock('../../../repositories/voiceInput/isNativeVoiceInputAvailable', () => ({
    isNativeVoiceInputAvailable: vi.fn(),
}));

describe('isVoiceInputAvailable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isBrowserSpeechRecognitionAvailable).mockReturnValue(false);
        vi.mocked(isNativeVoiceInputAvailable).mockReturnValue(false);
    });

    it('should return true when browser speech recognition is available', () => {
        vi.mocked(isBrowserSpeechRecognitionAvailable).mockReturnValue(true);

        expect(isVoiceInputAvailable()).toBe(true);
    });

    it('should return true when native desktop voice input is available', () => {
        vi.mocked(isNativeVoiceInputAvailable).mockReturnValue(true);

        expect(isVoiceInputAvailable()).toBe(true);
    });

    it('should return false when neither browser speech nor native desktop voice input is available', () => {
        expect(isVoiceInputAvailable()).toBe(false);
    });
});
