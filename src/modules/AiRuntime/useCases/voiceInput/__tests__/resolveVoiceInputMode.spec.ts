import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isNativeVoiceInputAvailable } from '../../../repositories/voiceInput/isNativeVoiceInputAvailable';
import { resolveVoiceInputMode } from '../resolveVoiceInputMode';

vi.mock('../../../repositories/voiceInput/isNativeVoiceInputAvailable', () => ({
    isNativeVoiceInputAvailable: vi.fn(),
}));

describe('resolveVoiceInputMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isNativeVoiceInputAvailable).mockReturnValue(false);
    });

    it('uses Whisper only when the native local voice capability is verified', () => {
        vi.mocked(isNativeVoiceInputAvailable).mockReturnValue(true);

        expect(resolveVoiceInputMode()).toBe('whisper');
    });

    it('reports unavailable without a verified native local model', () => {
        expect(resolveVoiceInputMode()).toBeNull();
    });
});
