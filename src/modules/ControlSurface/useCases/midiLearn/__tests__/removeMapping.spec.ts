import { beforeEach, describe, expect, it, vi } from 'vitest';

import { removeMapping } from '../removeMapping';

const dispatched: { type: string; payload: unknown }[] = [];

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: (action: { type: string; payload: unknown }) => {
        dispatched.push(action);
        return Promise.resolve();
    },
}));

describe('removeMapping', () => {
    beforeEach(() => {
        dispatched.length = 0;
    });

    it('dispatches removeMidiMapping with the given mapping id (audit A-1)', () => {
        removeMapping('m1');

        expect(dispatched).toEqual([{ type: 'removeMidiMapping', payload: { mappingId: 'm1' } }]);
    });

    it('dispatches unconditionally — existence and no-op checks belong to handleRemoveMidiMapping', () => {
        removeMapping('does-not-exist');

        expect(dispatched).toEqual([{ type: 'removeMidiMapping', payload: { mappingId: 'does-not-exist' } }]);
    });
});
