import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addWarpMarker } from '../addWarpMarker';

const mocks = vi.hoisted(() => ({
    audioWarpStoreValue: { value: { clipSettings: new Map() } },
    audioWarpStoreSet: vi.fn(),
    getNextWarpMarkerId: vi.fn(() => 'wm-123'),
}));

vi.mock('#/modules/AudioEngine/stores/audioWarp', () => ({
    audioWarpStore: {
        get value() {
            return mocks.audioWarpStoreValue.value;
        },
        set: mocks.audioWarpStoreSet,
    },
    DEFAULT_WARP_SETTINGS: { markers: [] },
    getNextWarpMarkerId: mocks.getNextWarpMarkerId,
}));

describe('addWarpMarker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioWarpStoreValue.value = { clipSettings: new Map() } as any;
    });

    it('adds a marker and sorts by sourceSec', () => {
        const existing = { markers: [{ id: 'm1', sourceSec: 10, targetBeat: 10 }] };
        mocks.audioWarpStoreValue.value.clipSettings.set('c1', existing);

        // Add marker at sourceSec 5 (should be first)
        addWarpMarker('c1', 5, 4);

        expect(mocks.audioWarpStoreSet).toHaveBeenCalledTimes(1);
        const markers = mocks.audioWarpStoreSet.mock.calls[0]?.[0].clipSettings.get('c1').markers;
        expect(markers).toHaveLength(2);
        expect(markers[0].sourceSec).toBe(5);
        expect(markers[1].id).toBe('m1');
    });
});
