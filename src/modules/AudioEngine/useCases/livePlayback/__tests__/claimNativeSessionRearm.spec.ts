/**
 * The one-re-arm-per-play guard the automatic native restart runs behind
 * (#3960).
 *
 * The claim is proven against the real `stopNativeLiveGraphSession`, because
 * the stop is the only thing that ever hands the guard back: a session-less
 * stop still runs the unconditional head of its queued work, which is exactly
 * the case a musician hits after the engine was lost.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claimNativeSessionRearm } from '../claimNativeSessionRearm';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { nativeSessionRearmClaimHolds } from '../nativeSessionRearmClaimHolds';
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
