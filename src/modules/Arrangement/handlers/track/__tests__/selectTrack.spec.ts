import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSelectTrack } from '../selectTrack';

const mocks = vi.hoisted(() => ({
    selectTrack: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({
    selectTrack: mocks.selectTrack,
}));

describe('handleSelectTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes selectTrack with the provided payload', () => {
        void handleSelectTrack.execute({
            type: 'selectTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.selectTrack).toHaveBeenCalledWith('t1');
    });

    it('provides a description', () => {
        const desc = handleSelectTrack.describe({
            type: 'selectTrack',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Select track');
    });

    it('is not undoable', () => {
        expect(handleSelectTrack.undoable).toBe(false);
    });
});
