import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setWarpAlgorithm } from '../setWarpAlgorithm';

import type { ClipWarpSettings } from '../../../stores/audioWarp';

const mocks = vi.hoisted(() => ({
    audioWarpStoreValue: {
        value: {
            clipSettings: new Map<string, import('../../../stores/audioWarp').ClipWarpSettings>(),
            defaultAlgorithm: 'repitch' as const,
            globalPitchShift: 0,
        },
    },
    audioWarpStoreSet: vi.fn<(state: import('../../../stores/audioWarp').WarpState) => void>(),
}));

vi.mock('../../../stores/audioWarp', () => ({
    audioWarpStore: {
        get value() {
            return mocks.audioWarpStoreValue.value;
        },
        set: mocks.audioWarpStoreSet,
    },
    DEFAULT_WARP_SETTINGS: { algorithm: 'repitch' },
}));

describe('setWarpAlgorithm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioWarpStoreValue.value = {
            clipSettings: new Map<string, ClipWarpSettings>(),
            defaultAlgorithm: 'repitch',
            globalPitchShift: 0,
        };
    });

    it('sets the warping algorithm', () => {
        setWarpAlgorithm('c1', 'wsola');
        const update = mocks.audioWarpStoreSet.mock.calls[0]?.[0];
        expect(update?.clipSettings.get('c1')?.algorithm).toBe('wsola');
    });
});
