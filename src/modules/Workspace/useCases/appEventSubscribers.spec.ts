import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    onProjectSave,
    onProjectNew,
    onCommandUndo,
    onCommandRedo,
    onMidiImport,
} from './appEventSubscribers';

type EventBusShape = {
    on: ReturnType<typeof vi.fn>;
};

describe('appEventSubscribers', () => {
    it('should subscribe to project.save', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onProjectSave, { eventBus });

        const handler = vi.fn();
        expect(onProjectSave(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('project.save', handler);
    });

    it('should subscribe to project.new', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onProjectNew, { eventBus });

        const handler = vi.fn();
        expect(onProjectNew(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('project.new', handler);
    });

    it('should subscribe to command.undo', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onCommandUndo, { eventBus });

        const handler = vi.fn();
        expect(onCommandUndo(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('command.undo', handler);
    });

    it('should subscribe to command.redo', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onCommandRedo, { eventBus });

        const handler = vi.fn();
        expect(onCommandRedo(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('command.redo', handler);
    });

    it('should subscribe to midi.import', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onMidiImport, { eventBus });

        const handler = vi.fn();
        expect(onMidiImport(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('midi.import', handler);
    });
});
