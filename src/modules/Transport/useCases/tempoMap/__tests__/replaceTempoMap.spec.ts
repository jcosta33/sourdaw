import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: execute }));

import { replaceTempoMap } from '../replaceTempoMap';

// Row, source and saved-history behavior lives in tempoMapCommands.integration;
// this public wrapper must return the real owning Command promise.
describe('replaceTempoMap', () => {
    beforeEach(() => {
        execute.mockReset();
    });

    it('returns the actual Command completion for the requested musical edit', async () => {
        const completion = Promise.resolve();
        execute.mockReturnValue(completion);
        expect(replaceTempoMap({ changes: [{ beat: 4, tempo: 140, curve: 'linear' }] })).toBe(completion);
        expect(execute).toHaveBeenCalledExactlyOnceWith({
            type: 'editTempoMap',
            payload: { edit: { type: 'replace', changes: [{ beat: 4, tempo: 140, curve: 'linear' }] } },
        });
        await completion;
    });

    it('preserves a Command refusal for its caller', async () => {
        const failure = new Error('Owning row changed');
        execute.mockRejectedValue(failure);
        await expect(replaceTempoMap({ changes: [{ beat: 4, tempo: 140, curve: 'linear' }] })).rejects.toBe(failure);
    });
    it.each([
        { beat: -1, tempo: 120, curve: 'instant' as const },
        { beat: 0, tempo: Number.POSITIVE_INFINITY, curve: 'linear' as const },
        { beat: 0, tempo: 1000, curve: 'instant' as const },
    ])('rejects the complete invalid batch before admission or ID allocation: %j', (invalid) => {
        const uuid = vi.spyOn(crypto, 'randomUUID');
        expect(() => replaceTempoMap({ changes: [{ beat: 0, tempo: 90, curve: 'instant' }, invalid] })).toThrow(
            RangeError
        );
        expect(execute).not.toHaveBeenCalled();
        expect(uuid).not.toHaveBeenCalled();
        uuid.mockRestore();
    });
});
