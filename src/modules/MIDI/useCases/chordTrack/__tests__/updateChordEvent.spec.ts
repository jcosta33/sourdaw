import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { updateChordEvent } from '../updateChordEvent';

const mocks = vi.hoisted((): { state: { enabled: boolean; events: unknown[] } | null; set: Mock } => ({
    state: { enabled: true, events: [] },
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

describe('updateChordEvent', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = {
            enabled: true,
            events: [{ id: 'e1', beat: 0, root: 0, quality: 'major', duration: 4 }],
        };
    });

    it('should not update the store when chord track state is null', () => {
        mocks.state = null;

        updateChordEvent('e1', { root: 5 });

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should apply root modulo 12, quality, and minimum duration', () => {
        updateChordEvent('e1', { root: 14, quality: 'minor', duration: 0.1 });

        expect(mocks.set).toHaveBeenCalledWith({
            enabled: true,
            events: [
                {
                    id: 'e1',
                    beat: 0,
                    root: 2,
                    quality: 'minor',
                    duration: 0.25,
                },
            ],
        });
    });

    it('normalizes a negative root into the 0-11 range (sign-safe)', () => {
        updateChordEvent('e1', { root: -1 });

        const [updated] = mocks.set.mock.calls[0] as [{ events: Array<{ root: number }> }];
        // -1 must wrap to 11, not stay negative (`-1 % 12 === -1`).
        expect(updated.events[0]?.root).toBe(11);
    });
});
