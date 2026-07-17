import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveWarpMarker } from '../moveWarpMarker';

const mocks = vi.hoisted(() => ({
    audioWarpStoreValue: { value: { clipSettings: new Map() } },
    audioWarpStoreSet: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores/audioWarp', () => ({
    audioWarpStore: {
        get value() {
            return mocks.audioWarpStoreValue.value;
        },
        set: mocks.audioWarpStoreSet,
    },
}));

describe('moveWarpMarker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioWarpStoreValue.value = { clipSettings: new Map() } as any;
    });

    it('updates targetBeat of the specified marker', () => {
        mocks.audioWarpStoreValue.value.clipSettings.set('c1', {
            markers: [{ id: 'm1', targetBeat: 0, locked: false }],
        });

        moveWarpMarker('c1', 'm1', 4);

        const markers = mocks.audioWarpStoreSet.mock.calls[0]?.[0].clipSettings.get('c1').markers;
        expect(markers[0].targetBeat).toBe(4);
    });

    it('refuses to move a locked marker', () => {
        mocks.audioWarpStoreValue.value.clipSettings.set('c1', {
            markers: [{ id: 'm1', targetBeat: 0, locked: true }],
        });

        moveWarpMarker('c1', 'm1', 4);

        const markers = mocks.audioWarpStoreSet.mock.calls[0]?.[0].clipSettings.get('c1').markers;
        expect(markers[0].targetBeat).toBe(0);
    });
});
