import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { handleKeydown, handleKeyup, type KeyDescriptor } from './handleKeyboardShortcut';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('handleKeyboardShortcut', () => {
    it('should emit voice.toggle on keyup for v', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(handleKeyup, { eventBus });

        handleKeyup('v');

        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: false });
    });

    it('should emit voice.toggle on keydown for v when not in an input', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(handleKeydown, { eventBus });

        const desc: KeyDescriptor = {
            key: 'v',
            mod: false,
            shift: false,
            alt: false,
            repeat: false,
            isInput: false,
        };

        const prevent = handleKeydown(desc);

        expect(prevent).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: true });
    });
});
