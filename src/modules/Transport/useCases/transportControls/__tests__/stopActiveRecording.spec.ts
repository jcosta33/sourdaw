import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { recordingLifecycle } from '../recordingLifecycle';
import { stopActiveRecording } from '../stopActiveRecording';

vi.mock('#/modules/Arrangement/useCases', () => ({
    stopRecording: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    stopAudioRecording: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('stopActiveRecording', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should clear a pending count-in timer exactly once when stopping recording', () => {
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const countInCallback = vi.fn();
        const startCountInTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout;
        const timerId = startCountInTimer(countInCallback, 1000);
        recordingLifecycle.setCountInTimerId(timerId);

        void stopActiveRecording();
        void stopActiveRecording();
        vi.advanceTimersByTime(1000);

        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(countInCallback).not.toHaveBeenCalled();
        expect(stopAudioRecording).toHaveBeenCalledTimes(2);
        expect(stopRecording).toHaveBeenCalledTimes(2);
        expect(updateTransportState).toHaveBeenCalledWith({ isRecording: false });
    });

    it('should stop recording without clearing a timer when no count-in is pending', () => {
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

        void stopActiveRecording();

        expect(clearTimeoutSpy).not.toHaveBeenCalled();
        expect(stopAudioRecording).toHaveBeenCalledTimes(1);
        expect(stopRecording).toHaveBeenCalledTimes(1);
        expect(updateTransportState).toHaveBeenCalledWith({ isRecording: false });
    });

    it('invalidates a recorder start that is still pending', () => {
        const token = recordingLifecycle.beginPendingRecordingStart();

        void stopActiveRecording();

        expect(recordingLifecycle.ownsPendingRecordingStart(token)).toBe(false);
    });
});
