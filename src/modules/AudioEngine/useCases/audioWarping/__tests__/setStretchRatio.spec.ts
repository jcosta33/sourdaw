import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setStretchRatio } from '../setStretchRatio';

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
    DEFAULT_WARP_SETTINGS: { stretchRatio: 1 },
}));

describe('setStretchRatio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioWarpStoreValue.value = { clipSettings: new Map() } as any;
    });

    it('sets the stretch ratio clamped between 0.1 and 10', () => {
        setStretchRatio('c1', 2.0);
        expect(mocks.audioWarpStoreSet.mock.calls[0]?.[0].clipSettings.get('c1').stretchRatio).toBe(2.0);

        setStretchRatio('c1', 50);
        expect(mocks.audioWarpStoreSet.mock.calls[1]?.[0].clipSettings.get('c1').stretchRatio).toBe(10);

        setStretchRatio('c1', 0.001);
        expect(mocks.audioWarpStoreSet.mock.calls[2]?.[0].clipSettings.get('c1').stretchRatio).toBe(0.1);
    });
});
