import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: execute }));

import { removeTempoChange } from '../removeTempoChange';

// Row, source and saved-history behavior lives in tempoMapCommands.integration;
// this public wrapper must return the real owning Command promise.
describe('removeTempoChange', () => {
    beforeEach(() => {
        execute.mockReset();
    });

    it('returns the actual Command completion for the requested musical edit', async () => {
        const completion = Promise.resolve();
        execute.mockReturnValue(completion);
        expect(removeTempoChange('head')).toBe(completion);
        expect(execute).toHaveBeenCalledExactlyOnceWith({
            type: 'editTempoMap',
            payload: { edit: { type: 'remove', id: 'head' } },
        });
        await completion;
    });

    it('preserves a Command refusal for its caller', async () => {
        const failure = new Error('Owning row changed');
        execute.mockRejectedValue(failure);
        await expect(removeTempoChange('head')).rejects.toBe(failure);
    });
});
