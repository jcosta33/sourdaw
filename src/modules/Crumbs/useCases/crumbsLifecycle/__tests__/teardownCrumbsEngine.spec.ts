import { describe, it, expect, vi, beforeEach } from 'vitest';

const destroyCrumbsInstance = vi.hoisted(() =>
    vi.fn<typeof import('../../../repositories/crumbsBridge/destroyCrumbsInstance').destroyCrumbsInstance>(() =>
        Promise.resolve()
    )
);
const stopCrumbsRecordFeed = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/crumbsBridge/destroyCrumbsInstance', () => ({
    destroyCrumbsInstance,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    stopCrumbsRecordFeed,
}));

import { teardownCrumbsEngine } from '../teardownCrumbsEngine';

describe('teardownCrumbsEngine', () => {
    beforeEach(() => {
        destroyCrumbsInstance.mockClear();
        stopCrumbsRecordFeed.mockClear();
    });

    it('disarms the record feed before the instance\u2019s bridge is destroyed', async () => {
        // Teardown is an armed take ending without a stop gesture: without
        // this disarm the shared tap keeps posting per-quantum IPC for an
        // instance whose bridge no longer exists.
        await teardownCrumbsEngine('inst-A');

        expect(stopCrumbsRecordFeed).toHaveBeenCalledTimes(1);
        expect(stopCrumbsRecordFeed).toHaveBeenCalledWith('inst-A');
        expect(destroyCrumbsInstance).toHaveBeenCalledWith('inst-A');

        // Disarm first, so nothing feeds a bridge destroyed by this very
        // call.
        const feedDisarm = stopCrumbsRecordFeed.mock.invocationCallOrder[0];
        const destroy = destroyCrumbsInstance.mock.invocationCallOrder[0];
        if (feedDisarm === undefined || destroy === undefined) {
            throw new Error('expected both calls to have been made');
        }
        expect(feedDisarm).toBeLessThan(destroy);
    });
});
