import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeRecordingRef } from '#/modules/Arrangement/stores';
import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';
import { pendingTakeLandings } from '#/utils/pendingTakeLandings';

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

    describe('closing a take', () => {
        afterEach(() => {
            activeRecordingRef.current = [];
            vi.mocked(stopRecording).mockReset();
            vi.mocked(stopAudioRecording).mockReset();
        });

        it('is registered as closing until the take it closes has committed, and counts that take', async () => {
            activeRecordingRef.current = ['clip-1'];
            const commit = Promise.withResolvers<void>();
            vi.mocked(stopRecording).mockReturnValue(commit.promise);
            const settledBefore = recordingLifecycle.settledCommitCount;

            const stopping = stopActiveRecording();
            expect(recordingLifecycle.isClosingRecording()).toBe(true);
            expect(recordingLifecycle.settledCommitCount).toBe(settledBefore);

            commit.resolve();
            await stopping;

            expect(recordingLifecycle.isClosingRecording()).toBe(false);
            expect(recordingLifecycle.settledCommitCount).toBe(settledBefore + 1);
        });

        it('is registered as closing while the recorder flush is pending, even when no take was open', async () => {
            const flush = Promise.withResolvers<void>();
            vi.mocked(stopAudioRecording).mockReturnValueOnce(flush.promise);

            const stopping = stopActiveRecording();
            expect(recordingLifecycle.isClosingRecording()).toBe(true);

            flush.resolve();
            await stopping;
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('counts no take when no recording was open', async () => {
            const settledBefore = recordingLifecycle.settledCommitCount;

            await stopActiveRecording();

            expect(recordingLifecycle.settledCommitCount).toBe(settledBefore);
        });

        it('does not resolve a second stop before the first stop has closed the take', async () => {
            const flush = Promise.withResolvers<void>();
            vi.mocked(stopAudioRecording).mockReturnValueOnce(flush.promise).mockResolvedValue(undefined);
            let secondResolved = false;

            const first = stopActiveRecording();
            const second = stopActiveRecording().then(() => {
                secondResolved = true;
            });
            await vi.advanceTimersByTimeAsync(10);
            expect(secondResolved).toBe(false);

            flush.resolve();
            await Promise.all([first, second]);
            expect(secondResolved).toBe(true);
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('does not resolve before a punch-out commit in flight lands', async () => {
            const punchOutCommit = Promise.withResolvers<void>();
            recordingLifecycle.trackCommit(punchOutCommit.promise);
            let stopped = false;

            const stopping = stopActiveRecording().then(() => {
                stopped = true;
            });
            await vi.advanceTimersByTimeAsync(10);
            expect(stopped).toBe(false);

            punchOutCommit.resolve();
            await stopping;
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('does not resolve before an overdub pass the falling edge started has landed', async () => {
            const passLanding = Promise.withResolvers<void>();
            // The falling edge the stop writes is what starts the pass landing.
            vi.mocked(updateTransportState).mockImplementationOnce(() => {
                pendingTakeLandings.track(passLanding.promise);
            });
            let stopped = false;

            const stopping = stopActiveRecording().then(() => {
                stopped = true;
            });
            await vi.advanceTimersByTimeAsync(10);
            expect(stopped).toBe(false);
            expect(recordingLifecycle.isClosingRecording()).toBe(true);

            passLanding.resolve();
            await stopping;
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('resolves when the overdub pass the stop waited on was refused', async () => {
            const passLanding = Promise.withResolvers<void>();
            vi.mocked(updateTransportState).mockImplementationOnce(() => {
                pendingTakeLandings.track(passLanding.promise);
            });

            const stopping = stopActiveRecording();
            passLanding.reject(new Error('refused'));

            await expect(stopping).resolves.toBeUndefined();
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('rejects with its own failure and leaves nothing registered as closing', async () => {
            vi.mocked(stopAudioRecording).mockRejectedValueOnce(new Error('recorder flush failed'));

            await expect(stopActiveRecording()).rejects.toThrow('recorder flush failed');

            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });
    });
});
