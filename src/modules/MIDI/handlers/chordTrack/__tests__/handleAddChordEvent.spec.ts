import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddChordEvent } from '../handleAddChordEvent';

const mocks = vi.hoisted(() => ({
    addChordEvent: vi.fn<typeof import('../../../useCases/chordTrack/addChordEvent').addChordEvent>(),
}));

vi.mock('../../../useCases/chordTrack/addChordEvent', () => ({
    addChordEvent: mocks.addChordEvent,
}));

describe('handleAddChordEvent', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to addChordEvent with sanitized payload', () => {
        void handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { beat: 4, root: 0, quality: 'minor', duration: 8 },
        });

        expect(mocks.addChordEvent).toHaveBeenCalledWith(4, 0, 'minor', 8);
    });

    it('falls back to default quality if invalid', () => {
        void handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { beat: 0, root: 2, quality: 'garbage' as unknown as 'minor' },
        });

        expect(mocks.addChordEvent).toHaveBeenCalledWith(0, 2, 'major', 4);
    });
});
