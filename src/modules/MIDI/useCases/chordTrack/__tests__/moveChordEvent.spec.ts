import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { moveChordEvent } from '../moveChordEvent';

type ChordTrackState = {
    enabled: boolean;
    events: Array<{ id: string; beat: number; root: number; quality: 'major'; duration: number }>;
};

const mocks = vi.hoisted((): { state: ChordTrackState | null; set: Mock } => ({
    state: {
        enabled: true,
        events: [
            { id: 'a', beat: 4, root: 0, quality: 'major', duration: 4 },
            { id: 'b', beat: 8, root: 2, quality: 'major', duration: 4 },
        ],
    },
    set: vi.fn(),
}));

vi.mock('../../../stores/chordTrackStore', () => ({
    chordTrackStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

describe('moveChordEvent', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = {
            enabled: true,
            events: [
                { id: 'a', beat: 4, root: 0, quality: 'major', duration: 4 },
                { id: 'b', beat: 8, root: 2, quality: 'major', duration: 4 },
            ],
        };
    });

    it('should not update the store when chord track state is null', () => {
        mocks.state = null;

        moveChordEvent('a', 12);

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should update the event beat and keep events sorted by beat', () => {
        moveChordEvent('b', 2);

        expect(mocks.set).toHaveBeenCalledWith({
            enabled: true,
            events: [
                { id: 'b', beat: 2, root: 2, quality: 'major', duration: 4 },
                { id: 'a', beat: 4, root: 0, quality: 'major', duration: 4 },
            ],
        });
    });

    it('should clamp negative beats to zero', () => {
        moveChordEvent('a', -3);

        expect(mocks.set).toHaveBeenCalledWith({
            enabled: true,
            events: [
                { id: 'a', beat: 0, root: 0, quality: 'major', duration: 4 },
                { id: 'b', beat: 8, root: 2, quality: 'major', duration: 4 },
            ],
        });
    });
});
