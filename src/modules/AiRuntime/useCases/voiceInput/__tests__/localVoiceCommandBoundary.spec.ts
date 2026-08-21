import { describe, expect, it, vi } from 'vitest';

import { resolveVoiceInputMode } from '../resolveVoiceInputMode';
import { voiceCommandGesture } from '../voiceCommandGesture';

const mocks = vi.hoisted(() => ({
    isNativeVoiceInputAvailable: vi.fn<() => boolean>(() => false),
}));

vi.mock('../../../repositories/voiceInput/isNativeVoiceInputAvailable', () => ({
    isNativeVoiceInputAvailable: mocks.isNativeVoiceInputAvailable,
}));

describe('local voice command boundary', () => {
    it('reports standalone browser unavailable because no browser speech mode exists', () => {
        mocks.isNativeVoiceInputAvailable.mockReturnValue(false);

        expect(resolveVoiceInputMode()).toBeNull();
    });

    it('does not treat desktop alone as microphone admission', () => {
        mocks.isNativeVoiceInputAvailable.mockReturnValue(false);

        expect(resolveVoiceInputMode()).toBeNull();
    });

    it('rejects a forged or programmatic start token', () => {
        expect(voiceCommandGesture.consume({})).toBe(false);
    });
});
