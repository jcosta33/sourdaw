import { describe, it, expect, vi, beforeEach } from 'vitest';

const stopRecording = vi.hoisted(() =>
    vi.fn<typeof import('../../../repositories/crumbsBridge/stopRecording').stopRecording>(() => Promise.resolve())
);

vi.mock('../../../repositories/crumbsBridge/stopRecording', () => ({
    stopRecording,
}));

import { stopCrumbsRecording } from '../stopCrumbsRecording';

describe('stopCrumbsRecording', () => {
    beforeEach(() => {
        stopRecording.mockClear();
    });

    it('closes the native take for the instance it was given', async () => {
        await stopCrumbsRecording('inst-A');

        expect(stopRecording).toHaveBeenCalledTimes(1);
        expect(stopRecording).toHaveBeenCalledWith('inst-A');
    });

    it('closes the native take again when the stop gesture is repeated', async () => {
        await stopCrumbsRecording('inst-A');
        await stopCrumbsRecording('inst-A');

        expect(stopRecording).toHaveBeenCalledTimes(2);
    });
});
