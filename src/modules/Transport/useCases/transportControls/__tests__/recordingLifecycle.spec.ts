import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingStartStore } from '../../../stores';
import { recordingLifecycle } from '../recordingLifecycle';

// MIDI owns the overdub landing registry; the spec stands in for it with landings it controls.
const midi = vi.hoisted(() => {
    const landings = new Set<Promise<void>>();
    return {
        landings,
        isOverdubLanding: () => landings.size > 0,
        waitForOverdubLanding: async () => {
            while (landings.size > 0) {
                await Promise.allSettled([...landings]);
            }
        },
        countSettledOverdubPasses: () => 0,
    };
});

vi.mock('#/modules/MIDI/useCases', () => ({
    isOverdubLanding: midi.isOverdubLanding,
    waitForOverdubLanding: midi.waitForOverdubLanding,
    countSettledOverdubPasses: midi.countSettledOverdubPasses,
}));

function startLanding(): () => void {
    const landing = Promise.withResolvers<void>();
    const tracked = landing.promise.then(() => {
        midi.landings.delete(tracked);
    });
    midi.landings.add(tracked);
    return landing.resolve;
}

describe('recording start state published to handlers', () => {
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

    it('holds while a count-in timer runs and clears when a cancelled count-in drops it', () => {
        recordingLifecycle.setCountInTimerId(setTimeout(() => {}, 1000));
        expect(recordingStartStore.value).toBe(true);

        recordingLifecycle.setCountInTimerId(null);
        expect(recordingStartStore.value).toBe(false);
    });

    it('holds while admission is pending and clears on cancel and on completion', () => {
        recordingLifecycle.beginPendingRecordingStart();
        expect(recordingStartStore.value).toBe(true);
        recordingLifecycle.cancelPendingRecordingStart();
        expect(recordingStartStore.value).toBe(false);

        const token = recordingLifecycle.beginPendingRecordingStart();
        expect(recordingLifecycle.completePendingRecordingStart(token)).toBe(true);
        expect(recordingStartStore.value).toBe(false);
    });

    it('stays set while a count-in is cancelled but admission is still pending', () => {
        recordingLifecycle.setCountInTimerId(setTimeout(() => {}, 1000));
        recordingLifecycle.beginPendingRecordingStart();

        recordingLifecycle.setCountInTimerId(null);

        expect(recordingStartStore.value).toBe(true);
    });

    it('clears when a closing stop settles, whatever awaits it', async () => {
        const closing = Promise.withResolvers<void>();
        recordingLifecycle.trackClosing(closing.promise);
        expect(recordingStartStore.value).toBe(true);

        closing.resolve();

        await vi.waitFor(() => expect(recordingStartStore.value).toBe(false));
    });

    it('holds while an overdub landing is pending after the closing stop settled, and clears when it lands', async () => {
        const closing = Promise.withResolvers<void>();
        const land = startLanding();
        recordingLifecycle.trackClosing(closing.promise);
        closing.resolve();
        await vi.waitFor(() => expect(recordingLifecycle.isClosingRecording()).toBe(true));
        expect(recordingStartStore.value).toBe(true);

        land();

        await vi.waitFor(() => expect(recordingStartStore.value).toBe(false));
    });

    it.each(['closed', 'refused'] as const)(
        'holds while a take commit is pending and clears when it resolves %s',
        async (outcome) => {
            const commit = Promise.withResolvers<'refused' | 'closed'>();
            recordingLifecycle.trackTakeCommit(commit.promise);
            expect(recordingStartStore.value).toBe(true);

            commit.resolve(outcome);

            await vi.waitFor(() => expect(recordingStartStore.value).toBe(false));
        }
    );

    it('holds while a take commit is pending and clears when it rejects', async () => {
        const commit = Promise.withResolvers<'refused' | 'closed'>();
        recordingLifecycle.trackTakeCommit(commit.promise);
        const waited = recordingLifecycle.waitForCommits();
        expect(recordingStartStore.value).toBe(true);

        commit.reject(new Error('commit failed'));
        await waited;

        await vi.waitFor(() => expect(recordingStartStore.value).toBe(false));
    });

    it('holds while a commit is in flight and clears when it settles, even on failure', async () => {
        const commit = Promise.withResolvers<void>();
        recordingLifecycle.trackCommit(commit.promise);
        const waited = recordingLifecycle.waitForCommits();
        expect(recordingStartStore.value).toBe(true);

        commit.reject(new Error('commit failed'));
        await waited;

        await vi.waitFor(() => expect(recordingStartStore.value).toBe(false));
    });
});

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
