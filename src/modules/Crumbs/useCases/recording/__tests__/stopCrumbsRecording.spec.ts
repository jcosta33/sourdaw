import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stopRecording = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>());
vi.mock('../../../repositories/crumbsBridge/stopRecording', () => ({ stopRecording }));
vi.mock('../../../repositories/crumbsBridge/getCrumbsRecordingState', () => ({
    getCrumbsRecordingState: async () => ({
        instance_id: 'inst-A',
        instance_incarnation: '1',
        take_id: '9007199254740993',
        revision: '1',
        phase: 'recording',
        first_input: { position_frames: '17', frames: 128 },
        failure: null,
    }),
}));

import { stopCrumbsRecording } from '../stopCrumbsRecording';
import { syncCrumbsRecordingState } from '../syncCrumbsRecordingState';

describe('stopCrumbsRecording', () => {
    beforeEach(async () => {
        stopRecording.mockReset().mockResolvedValue(undefined);
        await syncCrumbsRecordingState('inst-A', 'attach');
    });
    afterEach(async () => {
        await syncCrumbsRecordingState('inst-A', 'detach');
    });

    it('stops the exact native take restored from the instance snapshot', async () => {
        await stopCrumbsRecording('inst-A');
        expect(stopRecording).toHaveBeenCalledExactlyOnceWith('inst-A', '9007199254740993');
    });

    it('shares an accepted Stop until native terminal processing completes', async () => {
        await stopCrumbsRecording('inst-A');
        await stopCrumbsRecording('inst-A');
        expect(stopRecording).toHaveBeenCalledExactlyOnceWith('inst-A', '9007199254740993');
    });
});
