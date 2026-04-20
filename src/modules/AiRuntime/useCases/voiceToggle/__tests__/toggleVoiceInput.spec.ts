import { describe, it, expect, vi, beforeEach } from 'vitest';

import { eventBus } from '#/app/registerDependencies';

import { toggleVoiceInput } from '../toggleVoiceInput';

vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
        emit: vi.fn(),
    },
}));

describe('toggleVoiceInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('emits voice.toggle with undefined active payload by default', () => {
        toggleVoiceInput();
        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: undefined });
    });

    it('emits voice.toggle with provided active state', () => {
        toggleVoiceInput(true);
        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: true });

        toggleVoiceInput(false);
        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: false });
    });
});
