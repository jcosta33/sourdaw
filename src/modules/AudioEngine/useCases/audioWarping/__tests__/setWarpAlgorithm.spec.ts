import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setWarpAlgorithm } from '../setWarpAlgorithm';

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
    DEFAULT_WARP_SETTINGS: { algorithm: 'beats' },
}));

describe('setWarpAlgorithm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioWarpStoreValue.value = { clipSettings: new Map() } as any;
    });

    it('sets the warping algorithm', () => {
        setWarpAlgorithm('c1', 'complex');
        expect(mocks.audioWarpStoreSet.mock.calls[0][0].clipSettings.get('c1').algorithm).toBe('complex');
    });
});
