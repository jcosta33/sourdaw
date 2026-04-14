import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTracks } from '../useTracks';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {},
}));

describe('useTracks', () => {
    it('returns tracks and selectedTrackId from store', () => {
        const mockTracks = [{ id: 't1', name: 'Track 1' }];
        mocks.useStore.mockReturnValue({
            tracks: mockTracks,
            selectedTrackId: 't1',
        });

        const { result } = renderHook(() => useTracks());

        expect(result.current.tracks).toEqual(mockTracks);
        expect(result.current.selectedTrackId).toBe('t1');
    });

    it('returns empty defaults if store is empty', () => {
        mocks.useStore.mockReturnValue({
            tracks: [],
            selectedTrackId: null,
        });

        const { result } = renderHook(() => useTracks());

        expect(result.current.tracks).toEqual([]);
        expect(result.current.selectedTrackId).toBeNull();
    });
});
