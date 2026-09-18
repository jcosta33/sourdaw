/**
 * The one-re-arm-per-play guard the automatic native restart runs behind
 * (#3960).
 *
 * The claim is proven against the real `stopNativeLiveGraphSession`, because
 * the stop is the only thing that ever hands the guard back: a session-less
 * stop still runs the unconditional head of its queued work, which is exactly
 * the case a musician hits after the engine was lost. The real
 * `startNativeLiveGraphSession` is here for the other half of the same
 * relation: it never hands the guard back, but it does move the epoch a claim
 * is bound to.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claimNativeSessionRearm } from '../claimNativeSessionRearm';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { nativeSessionRearmClaimHolds } from '../nativeSessionRearmClaimHolds';
import { startNativeLiveGraphSession } from '../startNativeLiveGraphSession';
import { stopNativeLiveGraphSession } from '../stopNativeLiveGraphSession';

vi.mock('../../trackAudioControls/setNativeCarriedTracks', () => ({ setNativeCarriedTracks: vi.fn() }));
vi.mock('../stopNativeEnginePlayheadFeed', () => ({ stopNativeEnginePlayheadFeed: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('claimNativeSessionRearm', () => {
    beforeEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.orphanedBackend = null;
        nativeLiveGraphSession.rearmClaimed = false;
        nativeLiveGraphSession.rearmEpoch = 0;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('answers the first caller of a play with the play epoch and refuses every one after it', () => {
        expect(claimNativeSessionRearm()).toBe(0);
        expect(claimNativeSessionRearm()).toBe(null);
        expect(claimNativeSessionRearm()).toBe(null);
    });

    it('hands the claim back on the stop that ends the play', async () => {
        expect(claimNativeSessionRearm()).toBe(0);

        await stopNativeLiveGraphSession({ positionSeconds: 4 });

        expect(claimNativeSessionRearm()).toBe(1);
    });

    it('a claim taken before a start no longer holds', async () => {
        // A start is the session for the play running now, so a recovery still
        // in flight for the play before it must stand down: without the epoch
        // moving, the reload would settle, find the claim holding and the shared
        // `isPlaying` flag true, and restart the engine under a play whose own
        // start is already building one.
        const claim = claimNativeSessionRearm();
        expect(claim).toBe(0);

        // The start declines on the missing bridge here; the epoch bump is
        // synchronous and is what this observes.
        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transport: { kind: 'held', webAudioRollingSince: () => null },
            transportMaps: {
                tempo: [{ startSeconds: 0, beatsPerMinute: 120 }],
                timeSignature: [{ startSeconds: 0, numerator: 4, denominator: 4 }],
                loopRegion: { enabled: false, startSeconds: 0, endSeconds: 0 },
            },
            sampleRate: 48_000,
        });

        expect(nativeSessionRearmClaimHolds(claim as number)).toBe(false);
    });

    it('a claim taken before the stop no longer holds after it', async () => {
        const claim = claimNativeSessionRearm();
        expect(claim).toBe(0);

        await stopNativeLiveGraphSession({ positionSeconds: 4 });

        expect(nativeSessionRearmClaimHolds(claim as number)).toBe(false);

        const nextClaim = claimNativeSessionRearm();
        expect(nextClaim).toBe(1);
        expect(nativeSessionRearmClaimHolds(nextClaim as number)).toBe(true);
    });
});
