import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTracks } from '../useTracks';

type TrackListViewState = {
    tracks: unknown[];
    selectedTrackId: string | null;
};

const trackState = vi.hoisted(() => ({ value: null as TrackListViewState | null }));
const subscribers = vi.hoisted(() => new Set<(v: TrackListViewState) => void>());

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => trackState.value ?? { tracks: [], selectedTrackId: null }),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackState.value;
        },
        subscribe: vi.fn((cb: (v: TrackListViewState) => void) => {
            subscribers.add(cb);
            return () => {
                subscribers.delete(cb);
            };
        }),
        subscribeReact: vi.fn((cb: () => void) => {
            const wrapper = () => cb();
            subscribers.add(wrapper);
            return () => {
                subscribers.delete(wrapper);
            };
        }),
        getSnapshot: () => trackState.value,
    },
}));

describe('useTracks', () => {
    beforeEach(() => {
        trackState.value = null;
        subscribers.clear();
    });

    it('returns the default (empty tracks, null selection) when the store has no value', () => {
        const { result } = renderHook(() => useTracks());

        // Removing the hook logic (reading state.tracks / state.selectedTrackId)
        // would fail this — the hook must surface the store's contents verbatim.
        expect(result.current.tracks).toEqual([]);
        expect(result.current.selectedTrackId).toBeNull();
    });

    it('projects the store tracks and selected track id onto the view model', () => {
        const tracks = [{ id: 'track-1' }, { id: 'track-2' }];
        trackState.value = { tracks, selectedTrackId: 'track-2' };

        const { result } = renderHook(() => useTracks());

        expect(result.current.tracks).toBe(tracks);
        expect(result.current.selectedTrackId).toBe('track-2');
    });

    it('returns a null selectedTrackId when none is selected', () => {
        trackState.value = { tracks: [{ id: 'x' }], selectedTrackId: null };

        const { result } = renderHook(() => useTracks());

        expect(result.current.selectedTrackId).toBeNull();
        expect(result.current.tracks).toHaveLength(1);
    });
});
