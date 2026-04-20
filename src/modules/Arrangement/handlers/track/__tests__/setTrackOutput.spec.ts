import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackOutput } from '../setTrackOutput';

const mocks = vi.hoisted(() => ({
    setTrackOutput: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/setTrackOutput', () => ({
    setTrackOutput: mocks.setTrackOutput,
}));

describe('handleSetTrackOutput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setTrackOutput with the provided payload', () => {
        handleSetTrackOutput.execute({
            type: 'setTrackOutput',
            payload: { trackId: 't1', outputId: 'main' },
        });

        expect(mocks.setTrackOutput).toHaveBeenCalledWith('t1', 'main');
    });

    it('provides a description', () => {
        const desc = handleSetTrackOutput.describe({
            type: 'setTrackOutput',
            payload: { trackId: 't1', outputId: 'main' },
        });
        expect(desc.label).toBe('Set track output');
    });

    it('is undoable', () => {
        expect(handleSetTrackOutput.undoable).toBe(true);
    });
});
