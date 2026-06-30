import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isVoiceInputAvailable } from '../isVoiceInputAvailable';
import { resolveVoiceInputMode } from '../resolveVoiceInputMode';

vi.mock('../resolveVoiceInputMode', () => ({
    resolveVoiceInputMode: vi.fn(),
}));

describe('isVoiceInputAvailable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(resolveVoiceInputMode).mockReturnValue(null);
    });

    it('should return true when browser speech recognition is available', () => {
        vi.mocked(resolveVoiceInputMode).mockReturnValue('browser');

        expect(isVoiceInputAvailable()).toBe(true);
        expect(resolveVoiceInputMode).toHaveBeenCalledWith();
    });

    it('should return true when native desktop voice input is available', () => {
        vi.mocked(resolveVoiceInputMode).mockReturnValue('whisper');

        expect(isVoiceInputAvailable()).toBe(true);
        expect(resolveVoiceInputMode).toHaveBeenCalledWith();
    });

    it('should return false when neither browser speech nor native desktop voice input is available', () => {
        expect(isVoiceInputAvailable()).toBe(false);
        expect(resolveVoiceInputMode).toHaveBeenCalledWith();
    });
});
