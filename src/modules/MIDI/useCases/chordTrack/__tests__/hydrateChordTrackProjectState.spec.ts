import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    set: vi.fn(),
}));

vi.mock('../../../stores/chordTrackStore', () => ({
    chordTrackStore: { set: mocks.set },
    defaultChordTrackState: { enabled: false, events: [] },
}));

import { hydrateChordTrackProjectState } from '../hydrateChordTrackProjectState';

describe('hydrateChordTrackProjectState', () => {
    beforeEach(() => {
        mocks.set.mockClear();
    });

    it('hydrates a JSON-roundtripped snapshot without retaining caller references', () => {
        const snapshot = {
            enabled: true,
            events: [{ id: 'chord-1', beat: 0, root: 9, quality: 'minor' as const, duration: 4 }],
        };
        const roundtripped = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;

        hydrateChordTrackProjectState(roundtripped);
        roundtripped.events[0]!.root = 0;

        expect(mocks.set).toHaveBeenCalledWith(snapshot);
    });

    it('resets stale chord-track state when a backward-compatible v1 snapshot omits the field', () => {
        hydrateChordTrackProjectState(undefined);

        expect(mocks.set).toHaveBeenCalledWith({ enabled: false, events: [] });
    });
});
