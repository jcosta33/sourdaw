import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeChordEvent } from '../removeChordEvent';

const mocks = vi.hoisted(() => ({
    state: { enabled: true, events: [] } as { enabled: boolean; events: unknown[] } | null,
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

describe('removeChordEvent', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = {
            enabled: true,
            events: [{ id: 'e1', beat: 0, root: 0, quality: 'major', duration: 4 }],
        };
    });

    it('should remove the matching event id from the chord track', () => {
        removeChordEvent('e1');

        expect(mocks.set).toHaveBeenCalledWith({
            enabled: true,
            events: [],
        });
    });

    it('should not update the store when chord track state is null', () => {
        mocks.state = null;

        removeChordEvent('e1');

        expect(mocks.set).not.toHaveBeenCalled();
    });
});
