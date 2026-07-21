import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackInput } from '../handleSetTrackInput';

const mocks = vi.hoisted(() => ({
    setTrackInput: vi.fn(),
}));

vi.mock('../../../useCases/setTrackInput', () => ({
    setTrackInput: mocks.setTrackInput,
}));

describe('handleSetTrackInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setTrackInput with payload', () => {
        mocks.setTrackInput.mockReturnValue(true);
        const result = handleSetTrackInput.execute({
            type: 'setTrackInput',
            payload: { trackId: 't1', inputId: 'in1' },
        });

        expect(mocks.setTrackInput).toHaveBeenCalledWith('t1', 'in1');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when input assignment is rejected', () => {
        mocks.setTrackInput.mockReturnValue(false);

        const result = handleSetTrackInput.execute({
            type: 'setTrackInput',
            payload: { trackId: 'vca-1', inputId: 'in1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('reports permitted input cleanup as a write', () => {
        mocks.setTrackInput.mockReturnValue(true);

        const result = handleSetTrackInput.execute({
            type: 'setTrackInput',
            payload: { trackId: 'vca-1', inputId: null },
        });

        expect(result).toEqual({ status: 'written' });
    });

    it('provides a description', () => {
        const desc = handleSetTrackInput.describe({
            type: 'setTrackInput',
            payload: { trackId: 't1', inputId: 'in1' },
        });
        expect(desc.label).toBe('Set track input');
    });

    it('is undoable', () => {
        expect(handleSetTrackInput.undoable).toBe(true);
    });
});
