import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { addChordEvent } from '../addChordEvent';

type ChordTrackState = {
    enabled: boolean;
    events: Array<{ id: string; beat: number; root: number; quality: string; duration: number }>;
};

const mocks = vi.hoisted((): { state: ChordTrackState | null; set: Mock<(newState: ChordTrackState) => void> } => ({
    state: { enabled: true, events: [] },
    set: vi.fn<(newState: ChordTrackState) => void>(),
}));

vi.mock('../../../stores/chordTrackStore', () => ({
    chordTrackStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

describe('addChordEvent', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { enabled: true, events: [] };
    });

    it('should return null and not write when chord track state is null', () => {
        mocks.state = null;

        expect(addChordEvent(0, 0, 'major', 4)).toBeNull();
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should append a chord event, sort by beat, and return the new event', () => {
        mocks.state = {
            enabled: true,
            events: [{ id: 'existing', beat: 8, root: 0, quality: 'major', duration: 4 }],
        };

        const created = addChordEvent(2, 5, 'minor', 2);

        expect(created).not.toBeNull();
        expect(created!.beat).toBe(2);
        expect(created!.root).toBe(5 % 12);
        expect(created!.quality).toBe('minor');
        expect(created!.duration).toBe(2);

        const call = mocks.set.mock.calls[0]![0];
        expect(call.events.map((event) => event.beat)).toEqual([2, 8]);
    });
});
