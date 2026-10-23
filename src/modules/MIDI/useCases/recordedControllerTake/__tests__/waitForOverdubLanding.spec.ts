import { describe, expect, it } from 'vitest';

import { pendingOverdubLandings } from '../../../repositories/webMidi/pendingOverdubLandings';
import { countSettledOverdubPasses } from '../countSettledOverdubPasses';
import { isOverdubLanding } from '../isOverdubLanding';
import { waitForOverdubLanding } from '../waitForOverdubLanding';

/** Whether `promise` has settled by the time a macrotask has run, which is all the microtasks it can wait on. */
async function settlesWithinATask(promise: Promise<void>): Promise<boolean> {
    let settled = false;
    void promise.then(() => {
        settled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return settled;
}

describe('overdub pass landings', () => {
    it('reads as landing until the pass has landed, then counts it settled', async () => {
        const settledBefore = countSettledOverdubPasses();
        const landing = Promise.withResolvers<void>();

        pendingOverdubLandings.track(landing.promise);
        expect(isOverdubLanding()).toBe(true);
        expect(countSettledOverdubPasses()).toBe(settledBefore);

        landing.resolve();
        await waitForOverdubLanding();
        expect(isOverdubLanding()).toBe(false);
        expect(countSettledOverdubPasses()).toBe(settledBefore + 1);
    });

    it('counts a refused pass as settled too, and the wait resolves', async () => {
        const settledBefore = countSettledOverdubPasses();

        pendingOverdubLandings.track(Promise.reject(new Error('refused')));

        await expect(waitForOverdubLanding()).resolves.toBeUndefined();
        expect(isOverdubLanding()).toBe(false);
        expect(countSettledOverdubPasses()).toBe(settledBefore + 1);
    });

    it('resolves at once when nothing is landing', async () => {
        await expect(waitForOverdubLanding()).resolves.toBeUndefined();
    });

    it('also waits for a pass registered while a stop is already waiting', async () => {
        const first = Promise.withResolvers<void>();
        const second = Promise.withResolvers<void>();
        pendingOverdubLandings.track(first.promise);

        const waiting = waitForOverdubLanding();
        // The next pass lands while the wait is parked on the first one.
        pendingOverdubLandings.track(second.promise);
        first.resolve();

        expect(await settlesWithinATask(waiting)).toBe(false);
        expect(isOverdubLanding()).toBe(true);

        second.resolve();
        await waiting;
        expect(isOverdubLanding()).toBe(false);
    });
});
