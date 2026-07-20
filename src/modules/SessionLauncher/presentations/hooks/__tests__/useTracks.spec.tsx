import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useTracks } from '../useTracks';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {},
}));

describe('useTracks', () => {
    it('returns tracks and selectedTrackId from the track store', () => {
        const mockTracks = [{ id: 't1', name: 'Track 1' }];
        mocks.useStore.mockReturnValue({
            tracks: mockTracks,
            selectedTrackId: 't1',
        });

        const { result } = renderHook(() => useTracks());

        expect(result.current.tracks).toEqual(mockTracks);
        expect(result.current.selectedTrackId).toBe('t1');
    });

    it('returns empty defaults when the store has no tracks selected', () => {
        mocks.useStore.mockReturnValue({
            tracks: [],
            selectedTrackId: null,
        });

        const { result } = renderHook(() => useTracks());

        expect(result.current.tracks).toEqual([]);
        expect(result.current.selectedTrackId).toBeNull();
    });
});
