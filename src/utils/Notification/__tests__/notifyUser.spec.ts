import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { notifyUser } from '../notifyUser';

const { emit } = vi.hoisted(() => ({
    emit: vi.fn(),
}));

describe('notifyUser', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: { emit } });
        emit.mockClear();
    });

    it('should emit ui.notify with message and default info level', () => {
        notifyUser('Hello');

        expect(emit).toHaveBeenCalledWith('ui.notify', { message: 'Hello', level: 'info' });
    });

    it('should emit ui.notify with the given level', () => {
        notifyUser('Done', 'success');

        expect(emit).toHaveBeenCalledWith('ui.notify', { message: 'Done', level: 'success' });
    });

    it('emits an optional contextual action with the notification', () => {
        const action = { label: 'Undo', isValid: () => true, execute: vi.fn() };
        notifyUser('Action available', 'info', action);

        expect(emit).toHaveBeenCalledWith('ui.notify', { message: 'Action available', level: 'info', action });
    });
});
