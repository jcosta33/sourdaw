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
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('answers the first caller of a play and refuses every one after it', () => {
        expect(claimNativeSessionRearm()).toBe(true);
        expect(claimNativeSessionRearm()).toBe(false);
        expect(claimNativeSessionRearm()).toBe(false);
    });

    it('hands the claim back on the stop that ends the play', async () => {
        expect(claimNativeSessionRearm()).toBe(true);

        await stopNativeLiveGraphSession({ positionSeconds: 4 });

        expect(claimNativeSessionRearm()).toBe(true);
    });
});
