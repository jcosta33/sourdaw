/**
 * The subscription that keeps the native sample pool ahead of the play gesture
 * (#3068) — specifically, what it does to the paths that dominate.
 *
 * `trackStore` is written on every fader move and every playhead tick, and a
 * prime is a bridge round trip carrying decoded PCM. So the two properties this
 * file exists to hold are about *restraint*: a burst of notifications must cost
 * one pass, and a pass must never run underneath another one. The third is
 * about recovery — a failed pass leaves the memo unchanged, so the subscription
 * that outlives it has to keep working.
 *
 * `primeNativeTimelineSamples` is the double, because what it registers is
 * proven in its own spec and what matters here is only how often it is called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';

import { syncNativeTimelineSamples } from '../syncNativeTimelineSamples';

const mocks = vi.hoisted(() => ({
    prime: vi.fn<() => Promise<unknown>>(),
    warn: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('../primeNativeTimelineSamples', () => ({
    primeNativeTimelineSamples: () => mocks.prime(),
}));
vi.mock('../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 48_000 }),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: mocks.debug },
}));

/** A deferred prime, so a pass can be held open while the project moves under it. */
function deferredPrime(): { settle: (value?: unknown) => void; reject: (error: Error) => void } {
    let settle = (_value?: unknown): void => {};
    let fail = (_error: Error): void => {};
    mocks.prime.mockImplementationOnce(
        () =>
            new Promise((resolve, reject) => {
                settle = (value) => resolve(value ?? { outcome: 'primed', sampleIds: [] });
                fail = reject;
            })
    );
    return { settle: (value) => settle(value), reject: (error) => fail(error) };
}

/** One notification. The content is irrelevant — the subscriber reads the store, not the event. */
function notifyProjectChanged(): void {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
}

/** Let every already-queued microtask run, which is where the flush lives. */
async function settleMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

let unsubscribe: (() => void) | null = null;

beforeEach(() => {
    mocks.prime.mockReset();
    mocks.prime.mockResolvedValue({ outcome: 'primed', sampleIds: [] });
    mocks.warn.mockClear();
    mocks.debug.mockClear();
});

afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
});

describe('syncNativeTimelineSamples', () => {
    it('collapses a synchronous burst of project writes into one prime pass', async () => {
        // A drag, an undo restoring a whole snapshot, or a CRDT hydration all
        // arrive as many writes in one turn. Priming per write would put a PCM
        // transfer behind each one.
        unsubscribe = syncNativeTimelineSamples();

        notifyProjectChanged();
        notifyProjectChanged();
        notifyProjectChanged();
        expect(mocks.prime).not.toHaveBeenCalled();

        await settleMicrotasks();

        expect(mocks.prime).toHaveBeenCalledTimes(1);
    });

    it('re-checks exactly once when the project moves while a pass is in the air', async () => {
        // The memo records an id only once its registration confirms, so a
        // second pass started underneath the first would push the same material
        // twice. One re-check on settle is what covers the change without
        // stacking passes.
        const first = deferredPrime();
        unsubscribe = syncNativeTimelineSamples();

        notifyProjectChanged();
        await settleMicrotasks();
        expect(mocks.prime).toHaveBeenCalledTimes(1);

        notifyProjectChanged();
        notifyProjectChanged();
        await settleMicrotasks();
        expect(mocks.prime).toHaveBeenCalledTimes(1);

        first.settle();
        await settleMicrotasks();

        expect(mocks.prime).toHaveBeenCalledTimes(2);
    });

    it('settles without a re-check when nothing moved during the pass', async () => {
        const first = deferredPrime();
        unsubscribe = syncNativeTimelineSamples();

        notifyProjectChanged();
        await settleMicrotasks();
        first.settle();
        await settleMicrotasks();

        expect(mocks.prime).toHaveBeenCalledTimes(1);
    });

    it('keeps priming after a pass fails, rather than poisoning every pass behind it', async () => {
        // A failed registration leaves the ids unknown, so the next pass has
        // work to do — and a subscriber stuck on `priming` would never do it,
        // leaving the play gesture to pay the whole transfer.
        const failing = deferredPrime();
        unsubscribe = syncNativeTimelineSamples();

        notifyProjectChanged();
        await settleMicrotasks();
        failing.reject(new Error('decode failed'));
        await settleMicrotasks();

        expect(mocks.warn).toHaveBeenCalledTimes(1);

        notifyProjectChanged();
        await settleMicrotasks();

        expect(mocks.prime).toHaveBeenCalledTimes(2);
    });

    it('stops priming once the caller unsubscribes', async () => {
        unsubscribe = syncNativeTimelineSamples();
        notifyProjectChanged();
        await settleMicrotasks();
        expect(mocks.prime).toHaveBeenCalledTimes(1);

        unsubscribe();
        unsubscribe = null;
        notifyProjectChanged();
        await settleMicrotasks();

        expect(mocks.prime).toHaveBeenCalledTimes(1);
    });

    it('reports a decline at debug and not as a failure', async () => {
        // A browser build declines every time. That is the platform, and it
        // must not read as something going wrong.
        mocks.prime.mockResolvedValue({ outcome: 'declined', reason: 'no desktop runtime' });
        unsubscribe = syncNativeTimelineSamples();

        notifyProjectChanged();
        await settleMicrotasks();

        expect(mocks.warn).not.toHaveBeenCalled();
        expect(mocks.debug).toHaveBeenCalledWith(expect.stringContaining('no desktop runtime'));
    });
});
