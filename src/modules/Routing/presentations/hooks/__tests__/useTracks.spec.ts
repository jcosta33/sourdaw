import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useStore } from '#/infra/store/useStore';

import { useTracks } from '../useTracks';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {},
}));

describe('useTracks', () => {
    it('reads tracks and selectedTrackId from the track store snapshot', () => {
        vi.mocked(useStore).mockReturnValue({
            tracks: [{ id: 't1', name: 'Kick', kind: 'audio', color: '#fff', sends: [], outputId: 'master' }],
            selectedTrackId: 't1',
        });

        const { result } = renderHook(() => useTracks());

        expect(result.current).toEqual({
            tracks: [{ id: 't1', name: 'Kick', kind: 'audio', color: '#fff', sends: [], outputId: 'master' }],
            selectedTrackId: 't1',
        });
    });

    it('falls back to an empty track list and no selection when the store has no snapshot yet', () => {
        vi.mocked(useStore).mockImplementation((_store: unknown, defaultValue: unknown) => defaultValue);

        const { result } = renderHook(() => useTracks());

        expect(result.current).toEqual({ tracks: [], selectedTrackId: null });
    });
});
