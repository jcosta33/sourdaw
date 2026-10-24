import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingLifecycle } from '../recordingLifecycle';

describe('recording lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        vi.useRealTimers();
    });

    it('should update the shared count-in timer handle', () => {
        const timerId = setTimeout(() => {}, 1000);

        recordingLifecycle.setCountInTimerId(timerId);
        expect(recordingLifecycle.countInTimerId).toBe(timerId);
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(true);

        recordingLifecycle.setCountInTimerId(null);
        expect(recordingLifecycle.countInTimerId).toBeNull();
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(false);
    });

    it('uses owner tokens to prevent a canceled start from completing', () => {
        const first = recordingLifecycle.beginPendingRecordingStart();

        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(true);
        expect(recordingLifecycle.ownsPendingRecordingStart(first)).toBe(true);

        recordingLifecycle.cancelPendingRecordingStart();
        expect(recordingLifecycle.completePendingRecordingStart(first)).toBe(false);

        const second = recordingLifecycle.beginPendingRecordingStart();
        expect(second).not.toBe(first);
        expect(recordingLifecycle.completePendingRecordingStart(second)).toBe(true);
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(false);
    });

    describe('closing recordings', () => {
        it('is not closing a recording when nothing was tracked', () => {
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('is closing a recording from the moment a stop is tracked until it settles', async () => {
            const closing = Promise.withResolvers<void>();
            recordingLifecycle.trackClosing(closing.promise);
            expect(recordingLifecycle.isClosingRecording()).toBe(true);

            closing.resolve();
            await recordingLifecycle.waitForClosing();

            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('waits for a stop that is registered while it waits', async () => {
            const first = Promise.withResolvers<void>();
            const second = Promise.withResolvers<void>();
            recordingLifecycle.trackClosing(first.promise);
            let waited = false;

            const waiting = recordingLifecycle.waitForClosing().then(() => {
                waited = true;
            });
            recordingLifecycle.trackClosing(second.promise);
            first.resolve();
            await vi.advanceTimersByTimeAsync(10);
            expect(waited).toBe(false);

            second.resolve();
            await waiting;
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('settles a wait for stops even when one of them rejects', async () => {
            const failing = Promise.withResolvers<void>();
            recordingLifecycle.trackClosing(failing.promise);

            failing.reject(new Error('recorder flush failed'));

            await expect(recordingLifecycle.waitForClosing()).resolves.toBeUndefined();
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
        });

        it('is closing a recording while a tracked commit is in flight, and counts it once it settles', async () => {
            const before = recordingLifecycle.settledCommitCount;
            const commit = Promise.withResolvers<void>();
            recordingLifecycle.trackCommit(commit.promise);

            expect(recordingLifecycle.isClosingRecording()).toBe(true);
            expect(recordingLifecycle.settledCommitCount).toBe(before);

            commit.resolve();
            await recordingLifecycle.waitForCommits();

            expect(recordingLifecycle.isClosingRecording()).toBe(false);
            expect(recordingLifecycle.settledCommitCount).toBe(before + 1);
        });

        it('counts a commit that rejects as settled', async () => {
            const before = recordingLifecycle.settledCommitCount;

            recordingLifecycle.trackCommit(Promise.reject(new Error('commit refused')));
            await recordingLifecycle.waitForCommits();

            expect(recordingLifecycle.isClosingRecording()).toBe(false);
            expect(recordingLifecycle.settledCommitCount).toBe(before + 1);
        });
    });
});
