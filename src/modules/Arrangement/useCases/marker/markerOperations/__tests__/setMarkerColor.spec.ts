import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setMarkerColor } from '../setMarkerColor';

type MockMarker = { id: string; color: string };
type MarkerHolder = { value: { markers: MockMarker[] } | null };

const mocks = vi.hoisted(() => {
    const holder: MarkerHolder = { value: { markers: [] } };
    return {
        markerStoreValue: holder,
        markerStoreSet: vi.fn(),
    };
});

vi.mock('../../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
        set: mocks.markerStoreSet,
    },
}));

describe('setMarkerColor', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates marker color', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'm1', color: '#000' }],
        };

        const changed = setMarkerColor('m1', '#fff');

        expect(changed).toBe(true);
        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [{ id: 'm1', color: '#fff' }],
        });
    });

    it('updates only the targeted marker and leaves others untouched', () => {
        mocks.markerStoreValue.value = {
            markers: [
                { id: 'm1', color: '#000' },
                { id: 'm2', color: '#0f0' },
            ],
        };

        setMarkerColor('m1', '#fff');

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [
                { id: 'm1', color: '#fff' },
                { id: 'm2', color: '#0f0' },
            ],
        });
    });

    it('is a no-op when the marker store has not loaded', () => {
        mocks.markerStoreValue.value = null;

        const changed = setMarkerColor('m1', '#fff');

        expect(changed).toBe(false);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });

    it('does not write when the marker is missing or already has the requested color', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'm1', color: '#fff' }],
        };

        const missing = setMarkerColor('missing', '#000');
        const unchanged = setMarkerColor('m1', '#fff');

        expect(missing).toBe(false);
        expect(unchanged).toBe(false);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
