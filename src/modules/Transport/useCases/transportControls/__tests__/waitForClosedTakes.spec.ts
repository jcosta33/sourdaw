import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordingLifecycle } from '../recordingLifecycle';
import { waitForClosedTakes } from '../waitForClosedTakes';

/** Far more reads than any settlement-driven wait makes; a polling loop reaches it without yielding. */
const POLL_LIMIT = 1000;

function yieldTask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('waitForClosedTakes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('resolves at once when no take is closing', async () => {
        await expect(waitForClosedTakes()).resolves.toBeUndefined();
    });

    it('waits for a tracked take commit to settle', async () => {
        const commit = Promise.withResolvers<void>();
        recordingLifecycle.trackCommit(commit.promise);
        let waited = false;

        const waiting = waitForClosedTakes().then(() => {
            waited = true;
        });
        await yieldTask();
        expect(waited).toBe(false);

        commit.resolve();
        await waiting;
        expect(recordingLifecycle.isClosingRecording()).toBe(false);
    });

    it('waits for a closing stop and the commit it registers while closing', async () => {
        const stop = Promise.withResolvers<void>();
        const commit = Promise.withResolvers<void>();
        recordingLifecycle.trackClosing(stop.promise);
        let waited = false;

        const waiting = waitForClosedTakes().then(() => {
            waited = true;
        });
        recordingLifecycle.trackCommit(commit.promise);
        stop.resolve();
        await yieldTask();
        expect(waited).toBe(false);

        commit.resolve();
        await waiting;
        expect(recordingLifecycle.isClosingRecording()).toBe(false);
    });

    it('lets two overlapping waits resolve on a commit that only settles on a later task', async () => {
        // A punch-out commit, with no stop closing: the commit settles behind a
        // macrotask, as one queued behind IndexedDB work does.
        const isClosingRecording = recordingLifecycle.isClosingRecording;
        let polls = 0;
        vi.spyOn(recordingLifecycle, 'isClosingRecording').mockImplementation(() => {
            polls += 1;
            if (polls > POLL_LIMIT) {
                throw new Error(`the wait read the lifecycle ${polls} times without yielding to the commit`);
            }
            return isClosingRecording();
        });
        let commitTimerFired = false;
        recordingLifecycle.trackCommit(
            new Promise<void>((resolve) => {
                setTimeout(() => {
                    commitTimerFired = true;
                    resolve();
                }, 0);
            })
        );

        const waits = await Promise.allSettled([waitForClosedTakes(), waitForClosedTakes()]);

        expect(waits).toEqual([
            { status: 'fulfilled', value: undefined },
            { status: 'fulfilled', value: undefined },
        ]);
        expect(commitTimerFired).toBe(true);
        expect(isClosingRecording()).toBe(false);
    });
});
