import { describe, expect, it } from 'vitest';

import { countSettledTakes } from '../countSettledTakes';
import { recordingLifecycle } from '../recordingLifecycle';

describe('countSettledTakes', () => {
    it('counts a take whose commit settles', async () => {
        const before = countSettledTakes();

        recordingLifecycle.trackCommit(Promise.resolve());
        await recordingLifecycle.waitForCommits();

        expect(countSettledTakes()).toBe(before + 1);
    });

    it('does not count a commit that is still in flight', async () => {
        const before = countSettledTakes();
        const commit = Promise.withResolvers<void>();

        recordingLifecycle.trackCommit(commit.promise);
        expect(countSettledTakes()).toBe(before);

        commit.resolve();
        await recordingLifecycle.waitForCommits();
        expect(countSettledTakes()).toBe(before + 1);
    });

    it('counts a commit that was retired by a rejection too', async () => {
        const before = countSettledTakes();

        recordingLifecycle.trackCommit(Promise.reject(new Error('commit refused')));
        await recordingLifecycle.waitForCommits();

        expect(countSettledTakes()).toBe(before + 1);
    });
});
