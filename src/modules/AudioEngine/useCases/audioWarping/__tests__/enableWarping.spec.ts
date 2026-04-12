import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enableWarping } from '../enableWarping';

const mocks = vi.hoisted(() => ({
    audioWarpStoreValue: { value: { clipSettings: new Map(), defaultAlgorithm: 'beats' } },
    audioWarpStoreSet: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores/audioWarp', () => ({
    audioWarpStore: {
        get value() { return mocks.audioWarpStoreValue.value; },
        set: mocks.audioWarpStoreSet,
    },
    DEFAULT_WARP_SETTINGS: { enabled: false, markers: [], stretchRatio: 1, algorithm: 'beats' },
}));

describe('enableWarping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioWarpStoreValue.value = { clipSettings: new Map(), defaultAlgorithm: 'beats' } as any;
    });

    it('enables warping for a clip and initializes settings if missing', () => {
        enableWarping('c1');

        expect(mocks.audioWarpStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.audioWarpStoreSet.mock.calls[0][0];
        const settings = newState.clipSettings.get('c1');
        expect(settings.enabled).toBe(true);
        expect(settings.algorithm).toBe('beats');
    });

    it('preserves existing settings when enabling', () => {
        const existing = { enabled: false, algorithm: 'complex', stretchRatio: 2, markers: [] };
        mocks.audioWarpStoreValue.value.clipSettings.set('c1', existing);

        enableWarping('c1');

        const newState = mocks.audioWarpStoreSet.mock.calls[0][0];
        const settings = newState.clipSettings.get('c1');
        expect(settings.enabled).toBe(true);
        expect(settings.algorithm).toBe('complex');
        expect(settings.stretchRatio).toBe(2);
    });
});
