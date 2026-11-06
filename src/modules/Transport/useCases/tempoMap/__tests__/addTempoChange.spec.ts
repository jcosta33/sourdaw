import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: execute }));

import { addTempoChange } from '../addTempoChange';

// Row, source and saved-history behavior lives in tempoMapCommands.integration;
// this public wrapper must return the real owning Command promise.
describe('addTempoChange', () => {
    beforeEach(() => {
        execute.mockReset();
    });

    it('returns the actual Command completion for the requested musical edit', async () => {
        const completion = Promise.resolve();
        execute.mockReturnValue(completion);
        expect(addTempoChange(4, 140, 'linear')).toBe(completion);
        expect(execute).toHaveBeenCalledExactlyOnceWith({
            type: 'editTempoMap',
            payload: { edit: { type: 'add', beat: 4, tempo: 140, curve: 'linear' } },
        });
        await completion;
    });

    it('preserves a Command refusal for its caller', async () => {
        const failure = new Error('Owning row changed');
        execute.mockRejectedValue(failure);
        await expect(addTempoChange(4, 140, 'linear')).rejects.toBe(failure);
    });
    it('retains the instant default curve', async () => {
        execute.mockResolvedValue(undefined);
        await addTempoChange(0, 120);
        expect(execute).toHaveBeenCalledExactlyOnceWith({
            type: 'editTempoMap',
            payload: { edit: { type: 'add', beat: 0, tempo: 120, curve: 'instant' } },
        });
    });
});
