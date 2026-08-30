/**
 * The store boundary every durable transport write crosses, against a live
 * native session (#3109).
 *
 * `transportStore` is the live subject, not a double: what reaches the
 * native session is projected from whatever the store actually holds, so a
 * spec that stubbed a write would only prove the projection agrees with
 * itself. Writes here go straight through `transportStore.set` rather than
 * through `setTempo`/`setLoopRegion`/etc, on purpose — that is the shape a
 * CRDT hydration or an undo/redo replay lands in, and it is exactly the path
 * a per-writer trigger could never cover.
 *
 * `hasLiveNativeGraphSession` and `updateNativeLiveGraphSessionTransportMaps`
 * are the doubles, because they are the boundary Transport is allowed to know
 * about AudioEngine through. What a parked-vs-rolling session does with the
 * maps is proven where the session lives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { transportStore } from '../../../stores/transportStore';
import { syncTransportMapsToNativeSession } from '../syncTransportMapsToNativeSession';

type TransportMaps = {
    tempo: { startSeconds: number; beatsPerMinute: number }[];
    loopRegion: { enabled: boolean; startSeconds: number; endSeconds: number } | null;
};

type MapsUpdate = (input: {
    transportMaps: TransportMaps;
}) => Promise<{ outcome: 'updated' } | { outcome: 'declined'; reason: string }>;

const mocks = vi.hoisted(() => ({
    hasSession: vi.fn<() => boolean>(),
    updateTransportMaps: vi.fn<MapsUpdate>(),
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    hasLiveNativeGraphSession: mocks.hasSession,
    updateNativeLiveGraphSessionTransportMaps: mocks.updateTransportMaps,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

/** The maps the last send carried, as the engine would receive them. */
function lastSentMaps(): TransportMaps | undefined {
    return mocks.updateTransportMaps.mock.lastCall?.[0].transportMaps;
}

/** A transport at 120 BPM with no loop, one field away from whatever the test needs. */
function setTransport(overrides?: Partial<TransportState>): void {
    transportStore.set({ ...defaultTransportState, tempo: 120, ...overrides });
}

let unsubscribe: (() => void) | null = null;

beforeEach(() => {
    mocks.hasSession.mockReset();
    mocks.hasSession.mockReturnValue(true);
    mocks.updateTransportMaps.mockReset();
    mocks.updateTransportMaps.mockResolvedValue({ outcome: 'updated' });
    mocks.logger.debug.mockClear();
    mocks.logger.warn.mockClear();
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
    // Establishes the baseline the subscription seeds its "last sent" diff
    // from, before the subscription itself is created inside each test.
    setTransport();
});

afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
});

describe('a durable field written straight to the store', () => {
    it('reaches a live session when the base tempo changes', async () => {
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ tempo: 140 });

        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));
        expect(lastSentMaps()?.tempo[0]?.beatsPerMinute).toBe(140);
    });

    it('reaches a live session for a hydration-style loop write that names no use case', async () => {
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ isLooping: true, loopStart: 4, loopEnd: 8 });

        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));
        expect(lastSentMaps()?.loopRegion).toEqual({ enabled: true, startSeconds: 2, endSeconds: 4 });
    });

    it('integrates a loop region through the tempo map, not the flat transport tempo', async () => {
        // Half tempo from beat 8 on: beat 8 lands four seconds in, and the
        // four beats after it take four seconds rather than two. A region
        // converted at the flat transport tempo would put the seam two
        // seconds early.
        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-8', beat: 8, tempo: 60, curve: 'instant' },
            ],
        });
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ isLooping: true, loopStart: 8, loopEnd: 12 });

        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));
        expect(lastSentMaps()?.loopRegion).toEqual({ enabled: true, startSeconds: 4, endSeconds: 8 });
    });
});

describe('fields outside the maps projection', () => {
    it('does not fire for isPlaying', async () => {
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ isPlaying: true });

        await vi.waitFor(() => expect(transportStore.value?.isPlaying).toBe(true));
        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });

    it('does not fire for master gain', async () => {
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ masterGain: 50 });

        await vi.waitFor(() => expect(transportStore.value?.masterGain).toBe(50));
        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });
});

describe('no live native session', () => {
    it('sends nothing', async () => {
        mocks.hasSession.mockReturnValue(false);
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ tempo: 140 });

        await vi.waitFor(() => expect(transportStore.value?.tempo).toBe(140));
        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });
});

describe('a native session that cannot take the maps', () => {
    it('logs a decline and nothing else', async () => {
        mocks.updateTransportMaps.mockResolvedValueOnce({
            outcome: 'declined',
            reason: 'no live native graph session',
        });
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ tempo: 140 });

        await vi.waitFor(() => expect(mocks.logger.debug).toHaveBeenCalledOnce());
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('logs a rejected round trip as a warning only', async () => {
        mocks.updateTransportMaps.mockRejectedValueOnce(new Error('bridge is gone'));
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ tempo: 140 });

        await vi.waitFor(() => expect(mocks.logger.warn).toHaveBeenCalledOnce());
    });

    it('re-attempts the current state on the next change after a decline, rather than dropping it', async () => {
        mocks.updateTransportMaps.mockResolvedValueOnce({
            outcome: 'declined',
            reason: 'no live native graph session',
        });
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ tempo: 140 });
        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));

        setTransport({ tempo: 150 });
        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(2));
        expect(lastSentMaps()?.tempo[0]?.beatsPerMinute).toBe(150);
    });
});

describe('a burst of edits landing in one tick', () => {
    it('collapses into one send carrying the last state', async () => {
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ tempo: 121 });
        setTransport({ tempo: 122 });
        setTransport({ tempo: 123 });

        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));
        expect(lastSentMaps()?.tempo[0]?.beatsPerMinute).toBe(123);
    });
});

describe('a write that lands only on a map store', () => {
    it('sends exactly once for a tempoMapStore change, with no transportStore write at all', async () => {
        unsubscribe = syncTransportMapsToNativeSession();

        tempoMapStore.set({ changes: [{ id: 'tempo-0', beat: 0, tempo: 90, curve: 'instant' }] });

        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));
        expect(lastSentMaps()?.tempo[0]?.beatsPerMinute).toBe(90);
    });

    it('sends for a timeSignatureMapStore change', async () => {
        unsubscribe = syncTransportMapsToNativeSession();

        timeSignatureMapStore.set({ changes: [{ id: 'ts-0', beat: 0, numerator: 3, denominator: 4 }] });

        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));
    });

    it('does not fire when transportStore is re-set with the same maps-relevant fields and the map stores are untouched', async () => {
        unsubscribe = syncTransportMapsToNativeSession();

        // Same maps-relevant fields as the beforeEach baseline, re-set as a
        // fresh object — proves the diff is by value on transportStore, not
        // by "any write landed here at all".
        setTransport();

        await vi.waitFor(() => expect(transportStore.value).toBeTruthy());
        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });
});

/** A promise plus the resolve/reject that settle it, for holding a round trip open mid-test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let settleResolve!: (value: T) => void;
    let settleReject!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        settleResolve = resolve;
        settleReject = reject;
    });
    return { promise, resolve: settleResolve, reject: settleReject };
}

describe('a store change that lands while a send is in flight', () => {
    it('re-diffs against the settled lastSent and sends the reverted state as a second send', async () => {
        const first = deferred<{ outcome: 'updated' }>();
        mocks.updateTransportMaps.mockReturnValueOnce(first.promise);
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ tempo: 140 });
        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));

        // Revert to the original 120 while the first send is still in
        // flight. A gate that only diffed against lastSent (still 120, not
        // yet advanced) would read this as "already synced" and drop it.
        setTransport({ tempo: 120 });
        // Give the microtask flush a chance to run and prove it does NOT
        // start a second overlapping round trip while one is in flight.
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1);

        first.resolve({ outcome: 'updated' });

        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(2));
        expect(lastSentMaps()?.tempo[0]?.beatsPerMinute).toBe(120);

        // lastSent now tracks the store: a subsequent no-op write sends
        // nothing further.
        mocks.updateTransportMaps.mockClear();
        setTransport({ tempo: 120 });
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });

    it('still sends the current state on settle when the in-flight send was declined', async () => {
        const first = deferred<{ outcome: 'declined'; reason: string }>();
        mocks.updateTransportMaps.mockReturnValueOnce(first.promise);
        unsubscribe = syncTransportMapsToNativeSession();

        setTransport({ tempo: 140 });
        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1));

        setTransport({ tempo: 145 });
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(1);

        mocks.updateTransportMaps.mockResolvedValueOnce({ outcome: 'updated' });
        first.resolve({ outcome: 'declined', reason: 'no live native graph session' });

        await vi.waitFor(() => expect(mocks.updateTransportMaps).toHaveBeenCalledTimes(2));
        expect(lastSentMaps()?.tempo[0]?.beatsPerMinute).toBe(145);
    });
});
