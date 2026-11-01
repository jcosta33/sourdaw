import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: execute }));

import { updateTempoChange } from '../updateTempoChange';

// Row, source and saved-history behavior lives in tempoMapCommands.integration;
// this public wrapper must return the real owning Command promise.
describe('updateTempoChange', () => {
    beforeEach(() => {
        execute.mockReset();
    });

    it('returns the actual Command completion for the requested musical edit', async () => {
        const completion = Promise.resolve();
        execute.mockReturnValue(completion);
        expect(updateTempoChange('head', 140)).toBe(completion);
        expect(execute).toHaveBeenCalledExactlyOnceWith({
            type: 'editTempoMap',
            payload: { edit: { type: 'update', id: 'head', tempo: 140 } },
        });
        await completion;
    });

    it('preserves a Command refusal for its caller', async () => {
        const failure = new Error('Owning row changed');
        execute.mockRejectedValue(failure);
        await expect(updateTempoChange('head', 140)).rejects.toBe(failure);
    });
});
