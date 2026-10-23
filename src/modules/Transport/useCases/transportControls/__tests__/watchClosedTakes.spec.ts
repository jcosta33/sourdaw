import { describe, expect, it } from 'vitest';

import { recordingLifecycle } from '../recordingLifecycle';
import { watchClosedTakes } from '../watchClosedTakes';

async function settleOneTakeCommit(): Promise<void> {
    const commit = Promise.resolve();
    recordingLifecycle.trackCommit(commit);
    await recordingLifecycle.waitForCommits();
}

describe('watchClosedTakes', () => {
    it('reports no closed take before any commit settles', () => {
        expect(watchClosedTakes().hasClosedTake()).toBe(false);
    });

    it('ignores commits that settled before the watch began', async () => {
        await settleOneTakeCommit();

        expect(watchClosedTakes().hasClosedTake()).toBe(false);
    });

    it('reports a take whose commit settles after the watch began', async () => {
        const watch = watchClosedTakes();

        await settleOneTakeCommit();

        expect(watch.hasClosedTake()).toBe(true);
    });

    it('does not report a commit that is still in flight', async () => {
        const watch = watchClosedTakes();
        const commit = Promise.withResolvers<void>();

        recordingLifecycle.trackCommit(commit.promise);
        expect(watch.hasClosedTake()).toBe(false);

        commit.resolve();
        await recordingLifecycle.waitForCommits();
        expect(watch.hasClosedTake()).toBe(true);
    });

    it('reports a commit that was retired by a rejection as closed too', async () => {
        const watch = watchClosedTakes();

        recordingLifecycle.trackCommit(Promise.reject(new Error('commit refused')));
        await recordingLifecycle.waitForCommits();

        expect(watch.hasClosedTake()).toBe(true);
    });

    it('stops reporting the takes it has acknowledged and reports the next one', async () => {
        const watch = watchClosedTakes();
        await settleOneTakeCommit();

        watch.acknowledge();
        expect(watch.hasClosedTake()).toBe(false);

        await settleOneTakeCommit();
        expect(watch.hasClosedTake()).toBe(true);
    });

    it('keeps independent watches independent', async () => {
        const first = watchClosedTakes();
        await settleOneTakeCommit();
        const second = watchClosedTakes();

        first.acknowledge();
        await settleOneTakeCommit();

        expect(first.hasClosedTake()).toBe(true);
        expect(second.hasClosedTake()).toBe(true);
        second.acknowledge();
        expect(first.hasClosedTake()).toBe(true);
        expect(second.hasClosedTake()).toBe(false);
    });
});
