import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleChordTrack } from '../toggleChordTrack';

const mocks = vi.hoisted(() => ({
    state: { enabled: false, events: [] } as { enabled: boolean; events: unknown[] } | null,
    set: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    chordTrackStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

describe('toggleChordTrack', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { enabled: false, events: [] };
    });

    it('should not update the store when chord track state is null', () => {
        mocks.state = null;

        toggleChordTrack();

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should flip enabled when no explicit value is passed', () => {
        toggleChordTrack();

        expect(mocks.set).toHaveBeenCalledWith({ enabled: true, events: [] });
    });

    it('should set enabled to the provided boolean', () => {
        toggleChordTrack(true);

        expect(mocks.set).toHaveBeenCalledWith({ enabled: true, events: [] });

        mocks.set.mockClear();
        mocks.state = { enabled: true, events: [] };

        toggleChordTrack(false);

        expect(mocks.set).toHaveBeenCalledWith({ enabled: false, events: [] });
    });
});
