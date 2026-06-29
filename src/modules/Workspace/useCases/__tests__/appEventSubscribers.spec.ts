import { beforeEach, describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { onCommandRedo } from '../appEventSubscribers/onCommandRedo';
import { onCommandUndo } from '../appEventSubscribers/onCommandUndo';
import { onMidiImport } from '../appEventSubscribers/onMidiImport';
import { onProjectNew } from '../appEventSubscribers/onProjectNew';
import { onProjectSave } from '../appEventSubscribers/onProjectSave';

const mocks = vi.hoisted(() => ({
    mockEventBus: {
        on: vi.fn(),
    },
}));

describe('appEventSubscribers', () => {
    beforeEach(() => {
        injectDependencies(onProjectSave, { eventBus: mocks.mockEventBus });
        mocks.mockEventBus.on.mockClear();
    });

    it('should subscribe to project.save', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        expect(onProjectSave(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('project.save', handler);
    });

    it('should subscribe to project.new', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        expect(onProjectNew(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('project.new', handler);
    });

    it('should subscribe to command.undo', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        expect(onCommandUndo(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('command.undo', handler);
    });

    it('should subscribe to command.redo', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        expect(onCommandRedo(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('command.redo', handler);
    });

    it('should subscribe to midi.import', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        expect(onMidiImport(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('midi.import', handler);
    });
});
