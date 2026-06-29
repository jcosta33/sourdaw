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

    it('should emit voice.toggle with active flag when toggleVoiceInput is called', () => {
        mockEventBus.emit.mockResolvedValue(undefined);

        toggleVoiceInput(true);

        expect(mockEventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: true });
    });

    it('should emit voice.toggle with undefined active when omitted', () => {
        mockEventBus.emit.mockResolvedValue(undefined);

        toggleVoiceInput();

        expect(mockEventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: undefined });
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
