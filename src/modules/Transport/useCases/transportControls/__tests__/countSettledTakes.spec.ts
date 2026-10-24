import { describe, expect, it, vi } from 'vitest';

// MIDI owns the overdub landings; Transport reads them through its use cases.
const overdub = vi.hoisted(() => {
    const state = { landing: null as Promise<void> | null, settled: 0 };
    return {
        state,
        land(landing: Promise<void>): void {
            const settle = (): void => {
                state.landing = null;
                state.settled += 1;
            };
            state.landing = landing.then(settle, settle);
        },
    };
});

vi.mock('#/modules/MIDI/useCases', () => ({
    isOverdubLanding: () => overdub.state.landing !== null,
    countSettledOverdubPasses: () => overdub.state.settled,
    waitForOverdubLanding: async () => {
        await overdub.state.landing;
    },
}));

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

    it('counts an overdub pass once it has landed or been refused, and not while it is landing', async () => {
        const before = countSettledTakes();
        const landing = Promise.withResolvers<void>();

        overdub.land(landing.promise);
        expect(countSettledTakes()).toBe(before);

        landing.resolve();
        await vi.waitFor(() => expect(countSettledTakes()).toBe(before + 1));

        overdub.land(Promise.reject(new Error('refused')));
        await vi.waitFor(() => expect(countSettledTakes()).toBe(before + 2));
    });

    it('counts a commit that was retired by a rejection too', async () => {
        const before = countSettledTakes();

        recordingLifecycle.trackCommit(Promise.reject(new Error('commit refused')));
        await recordingLifecycle.waitForCommits();

        expect(countSettledTakes()).toBe(before + 1);
    });
});
