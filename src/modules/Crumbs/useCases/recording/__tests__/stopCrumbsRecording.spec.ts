import { describe, it, expect, vi, beforeEach } from 'vitest';

const stopRecording = vi.hoisted(() =>
    vi.fn<typeof import('../../../repositories/crumbsBridge/stopRecording').stopRecording>(() => Promise.resolve())
);
const stopCrumbsRecordFeed = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/crumbsBridge/stopRecording', () => ({
    stopRecording,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    stopCrumbsRecordFeed,
}));

import { stopCrumbsRecording } from '../stopCrumbsRecording';

describe('stopCrumbsRecording', () => {
    beforeEach(() => {
        stopRecording.mockClear();
        stopCrumbsRecordFeed.mockClear();
    });

    it('disarms the record feed before closing the take', async () => {
        await stopCrumbsRecording('inst-A');

        expect(stopCrumbsRecordFeed).toHaveBeenCalledTimes(1);
        expect(stopRecording).toHaveBeenCalledWith('inst-A');
        // Producer first: a straggler monitored block after the native stop
        // would land on a closed take's bridge.
        const feedStop = stopCrumbsRecordFeed.mock.invocationCallOrder[0];
        const nativeStop = stopRecording.mock.invocationCallOrder[0];
        if (feedStop === undefined || nativeStop === undefined) {
            throw new Error('expected both stops to have been called');
        }
        expect(feedStop).toBeLessThan(nativeStop);
    });

    it('still closes the native take when the feed disarm is repeated', async () => {
        await stopCrumbsRecording('inst-A');
        await stopCrumbsRecording('inst-A');

        expect(stopRecording).toHaveBeenCalledTimes(2);
    });
});
