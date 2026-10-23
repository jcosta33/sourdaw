import { describe, expect, it } from 'vitest';

import { recordingLifecycle } from '../recordingLifecycle';
import { waitForClosedTakes } from '../waitForClosedTakes';

describe('waitForClosedTakes', () => {
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
        await Promise.resolve();
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
        await Promise.resolve();
        await Promise.resolve();
        expect(waited).toBe(false);

        commit.resolve();
        await waiting;
        expect(recordingLifecycle.isClosingRecording()).toBe(false);
    });
});
