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

    it('returns true only when local native voice input is verified', () => {
        vi.mocked(resolveVoiceInputMode).mockReturnValue('whisper');

        expect(isVoiceInputAvailable()).toBe(true);
        expect(resolveVoiceInputMode).toHaveBeenCalledWith();
    });

    it('returns false when local native voice input is unavailable', () => {
        expect(isVoiceInputAvailable()).toBe(false);
        expect(resolveVoiceInputMode).toHaveBeenCalledWith();
    });
});
