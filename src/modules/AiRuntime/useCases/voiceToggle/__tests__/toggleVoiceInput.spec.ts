import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleVoiceInput } from '../toggleVoiceInput';
import { eventBus } from '#/app/registerDependencies';

vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
        emit: vi.fn(),
    }
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
