import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setWarpAlgorithm } from '../setWarpAlgorithm';

import type { WarpState, ClipWarpSettings } from '#/modules/AudioEngine/stores/audioWarp';

const mocks = vi.hoisted(() => ({
    audioWarpStoreValue: {
        value: {
            clipSettings: new Map<string, import('#/modules/AudioEngine/stores/audioWarp').ClipWarpSettings>(),
            defaultAlgorithm: 'complex-pro' as const,
            globalPitchShift: 0,
        },
    },
    audioWarpStoreSet: vi.fn<(state: import('#/modules/AudioEngine/stores/audioWarp').WarpState) => void>(),
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
        mocks.audioWarpStoreValue.value = {
            clipSettings: new Map<string, ClipWarpSettings>(),
            defaultAlgorithm: 'complex-pro',
            globalPitchShift: 0,
        };
    });

    it('sets the warping algorithm', () => {
        setWarpAlgorithm('c1', 'complex');
        const update = mocks.audioWarpStoreSet.mock.calls[0]?.[0];
        expect(update?.clipSettings.get('c1')?.algorithm).toBe('complex');
    });
});
