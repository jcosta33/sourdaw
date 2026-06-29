import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { toggleVoiceInput } from '../toggleVoiceInput';

const mockEventBus = {
    emit: vi.fn(),
};

describe('toggleVoiceInput', () => {
    beforeEach(() => {
        injectDependencies(toggleVoiceInput, { eventBus: mockEventBus });
        vi.clearAllMocks();
    });

    it('emits voice.toggle with undefined active payload by default', () => {
        toggleVoiceInput();
        expect(mockEventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: undefined });
    });

    it('emits voice.toggle with provided active state', () => {
        toggleVoiceInput(true);
        expect(mockEventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: true });

        toggleVoiceInput(false);
        expect(mockEventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: false });
    });
});
