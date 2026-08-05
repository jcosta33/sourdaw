import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/chordTrack/addChordEvent', () => ({
    addChordEvent: vi.fn(),
}));

vi.mock('../handleRestoreChordTrackState', () => ({
    describeChordTrackMutation: vi.fn(() => ({ label: 'Mock', inverseAction: null })),
}));

import { addChordEvent } from '../../../useCases/chordTrack/addChordEvent';
import { handleAddChordEvent } from '../handleAddChordEvent';

const mockedAdd = vi.mocked(addChordEvent);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleAddChordEvent — execute sanitization', () => {
    it('passes valid quality through', () => {
        handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: 4, root: 5, quality: 'minor', duration: 2 },
        });
        expect(mockedAdd).toHaveBeenCalledWith(4, 5, 'minor', 2, 'e1');
    });

    it('defaults invalid quality to major', () => {
        handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: 0, root: 0, quality: 'nonexistent', duration: 4 },
        });
        expect(mockedAdd).toHaveBeenCalledWith(0, 0, 'major', 4, 'e1');
    });

    it('clamps root to 0-11 with rounding', () => {
        handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: 0, root: 15, quality: 'major', duration: 4 },
        });
        expect(mockedAdd).toHaveBeenCalledWith(0, 11, 'major', 4, 'e1');
    });

    it('clamps negative root to 0', () => {
        handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: 0, root: -3, quality: 'major', duration: 4 },
        });
        expect(mockedAdd).toHaveBeenCalledWith(0, 0, 'major', 4, 'e1');
    });

    it('rounds fractional root', () => {
        handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: 0, root: 5.7, quality: 'major', duration: 4 },
        });
        expect(mockedAdd).toHaveBeenCalledWith(0, 6, 'major', 4, 'e1');
    });

    it('floors negative beat to 0', () => {
        handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: -5, root: 0, quality: 'major', duration: 4 },
        });
        expect(mockedAdd).toHaveBeenCalledWith(0, 0, 'major', 4, 'e1');
    });

    it('defaults duration to 4 when omitted', () => {
        handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: 0, root: 0, quality: 'major' },
        });
        expect(mockedAdd).toHaveBeenCalledWith(0, 0, 'major', 4, 'e1');
    });

    it('generates chord- prefixed eventId when omitted', () => {
        const action = { type: 'addChordEvent' as const, payload: { beat: 0, root: 0, quality: 'major', duration: 4 } };
        handleAddChordEvent.execute(action);
        const id = mockedAdd.mock.calls[0]?.[4];
        expect(id).toMatch(/^chord-[0-9a-f-]+$/);
    });
});
