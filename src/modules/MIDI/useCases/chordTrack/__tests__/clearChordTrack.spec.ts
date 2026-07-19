import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { clearChordTrack } from '../clearChordTrack';

const mocks = vi.hoisted((): { state: { enabled: boolean; events: unknown[] } | null; set: Mock } => {
    const state: { enabled: boolean; events: unknown[] } | null = { enabled: true, events: [{ beat: 0 }] };
    return { state, set: vi.fn() };
});

vi.mock('../../../stores/chordTrackStore', () => ({
    chordTrackStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

describe('clearChordTrack', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { enabled: true, events: [{ beat: 0 }] };
    });

    it('should clear chord events while preserving other state', () => {
        clearChordTrack();

        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(mocks.set).toHaveBeenCalledWith({ enabled: true, events: [] });
    });

    it('should not update the store when chord track state is null', () => {
        mocks.state = null;

        clearChordTrack();

        expect(mocks.set).not.toHaveBeenCalled();
    });
});
