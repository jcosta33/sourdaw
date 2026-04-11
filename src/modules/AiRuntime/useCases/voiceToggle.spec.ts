import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toggleVoiceInput } from './voiceToggle/toggleVoiceInput';
import { onVoiceToggle } from './voiceToggle/onVoiceToggle';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
};

describe('voiceToggle', () => {
    it('should emit voice.toggle with active flag when toggleVoiceInput is called', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(toggleVoiceInput, { eventBus });

        toggleVoiceInput(true);

        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: true });
    });

    it('should emit voice.toggle with undefined active when omitted', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(toggleVoiceInput, { eventBus });

        toggleVoiceInput();

        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: undefined });
    });

    it('should subscribe to voice.toggle via onVoiceToggle', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onVoiceToggle, { eventBus });

        const handler = vi.fn();
        const result = onVoiceToggle(handler);

        expect(eventBus.on).toHaveBeenCalledWith('voice.toggle', handler);
        expect(result).toBe(unsubscribe);
    });
});
