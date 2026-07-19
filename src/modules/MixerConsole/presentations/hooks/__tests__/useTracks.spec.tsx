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
    it('returns the tracks and selectedTrackId read from the Arrangement track store', () => {
        const mockTracks = [
            { id: 't1', name: 'Track 1' },
            { id: 't2', name: 'Track 2' },
        ];
        mocks.useStore.mockReturnValue({
            tracks: mockTracks,
            selectedTrackId: 't2',
        });

        const { result } = renderHook(() => useTracks());

        expect(result.current.tracks).toEqual(mockTracks);
        expect(result.current.selectedTrackId).toBe('t2');
    });

    it('falls back to an empty list and no selection when the store is empty', () => {
        mocks.useStore.mockReturnValue({
            tracks: [],
            selectedTrackId: null,
        });

        const { result } = renderHook(() => useTracks());

        expect(result.current.tracks).toEqual([]);
        expect(result.current.selectedTrackId).toBeNull();
    });
});
