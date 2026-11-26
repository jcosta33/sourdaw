import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ tracks: vi.fn(), strip: vi.fn(), subscribe: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases', () => ({ getAllTracks: mocks.tracks }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ getTrackStrip: mocks.strip }));
vi.mock('#/modules/Crumbs/stores', () => ({ subscribeToCrumbsSamples: mocks.subscribe }));

import { initCrumbsSamplePush } from '../initCrumbsSamplePush';

describe('initCrumbsSamplePush', () => {
    it('refreshes only the existing ready node on the owning track', () => {
        const refresh = vi.fn();
        const unrelated = vi.fn();
        const stop = vi.fn();
        mocks.subscribe.mockReturnValue(stop);
        mocks.tracks.mockReturnValue([{ id: 'track', devices: [{ id: 'sampler' }] }]);
        mocks.strip.mockReturnValue({
            deviceNodes: [
                { deviceId: 'other', crumbsControls: { ready: true, refreshSample: unrelated } },
                { deviceId: 'sampler', crumbsControls: { ready: true, refreshSample: refresh } },
            ],
        });
        expect(initCrumbsSamplePush()).toBe(stop);
        const publish = mocks.subscribe.mock.calls[0][0];
        publish('sampler');
        expect(mocks.strip).toHaveBeenCalledWith('track');
        expect(refresh).toHaveBeenCalledOnce();
        expect(unrelated).not.toHaveBeenCalled();
        publish('absent');
        mocks.strip.mockReturnValue(undefined);
        publish('sampler');
        expect(refresh).toHaveBeenCalledOnce();
    });
});
