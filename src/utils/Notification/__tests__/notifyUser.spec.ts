import { describe, it, expect, vi, beforeEach } from 'vitest';

const { emit } = vi.hoisted(() => ({
    emit: vi.fn(),
}));

vi.mock('#/app/registerDependencies', () => ({
    eventBus: { emit },
}));

import { notifyUser } from '../notifyUser';

describe('notifyUser', () => {
    beforeEach(() => {
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
});
