import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { onVoiceToggle } from '../voiceToggle/onVoiceToggle';
import { toggleVoiceInput } from '../voiceToggle/toggleVoiceInput';

const { mockEventBus } = vi.hoisted(() => ({
    mockEventBus: {
        emit: vi.fn(),
        on: vi.fn(),
    },
}));

describe('voiceToggle', () => {
    beforeEach(() => {
        injectDependencies(toggleVoiceInput, { eventBus: mockEventBus });
        vi.clearAllMocks();
    });

    it('rejects a forged isTrusted-shaped event without emitting a voice toggle', () => {
        toggleVoiceInput({ isTrusted: true } as unknown as Event);

        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('fails closed for an absent activation instead of throwing', () => {
        expect(() => toggleVoiceInput(undefined as unknown as Event)).not.toThrow();

        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should subscribe to voice.toggle via onVoiceToggle', () => {
        const unsubscribe = vi.fn();
        mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        const result = onVoiceToggle(handler);

        expect(mockEventBus.on).toHaveBeenCalledWith('voice.toggle', handler);
        expect(result).toBe(unsubscribe);
    });
});
