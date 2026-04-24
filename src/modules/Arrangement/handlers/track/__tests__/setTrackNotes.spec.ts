import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackNotes } from '../setTrackNotes';

const mocks = vi.hoisted(() => ({
    setTrackNotes: vi.fn(),
}));

vi.mock('../../../useCases/setTrackGainPan/setTrackNotes', () => ({
    setTrackNotes: mocks.setTrackNotes,
}));

describe('handleSetTrackNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setTrackNotes with the provided payload', () => {
        void handleSetTrackNotes.execute({
            type: 'setTrackNotes',
            payload: { trackId: 't1', notes: 'Testing notes' },
        });

        expect(mocks.setTrackNotes).toHaveBeenCalledWith('t1', 'Testing notes');
    });

    it('provides a description', () => {
        const desc = handleSetTrackNotes.describe({
            type: 'setTrackNotes',
            payload: { trackId: 't1', notes: '' },
        });
        expect(desc.label).toBe('Set track notes');
    });

    it('is undoable', () => {
        expect(handleSetTrackNotes.undoable).toBe(true);
    });
});
