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
        handleSetTrackInput.execute({
            type: 'setTrackInput',
            payload: { trackId: 't1', inputId: 'in1' },
        });

        expect(mocks.setTrackInput).toHaveBeenCalledWith('t1', 'in1');
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
