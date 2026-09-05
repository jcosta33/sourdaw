/**
 * The predicate the Web Audio tick path reads before it writes a device
 * parameter over IPC (#3568).
 *
 * Both halves are load-bearing, and each one alone gives a wrong answer that
 * costs something audible. Claimed-strip alone would silence the IPC write for
 * a device the engine never built — the mapper degraded it, or a mid-roll
 * insert has not been spliced yet — and the parameter would sit wherever it was
 * left, driven by nobody. Chain-membership alone would silence it for a strip
 * Web Audio is still sounding, which is the same stranding on the other
 * carrier.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { isDeviceCarriedByNativeSession } from '../isDeviceCarriedByNativeSession';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';

function sessionHolds(input: { carried: readonly string[]; chains: Record<string, readonly string[]> }): void {
    nativeLiveGraphSession.carriedStripIds = new Set(input.carried);
    nativeLiveGraphSession.nativeChainByStripId = new Map(Object.entries(input.chains));
}

describe('isDeviceCarriedByNativeSession', () => {
    beforeEach(() => {
        sessionHolds({ carried: [], chains: {} });
    });

    it('answers true for a device in the reported chain of a claimed strip', () => {
        sessionHolds({ carried: ['track-1'], chains: { 'track-1': ['device-a', 'device-b'] } });

        expect(isDeviceCarriedByNativeSession('track-1', 'device-b')).toBe(true);
    });

    it('answers false for a device the claimed strip chain does not list', () => {
        sessionHolds({ carried: ['track-1'], chains: { 'track-1': ['device-a'] } });

        expect(isDeviceCarriedByNativeSession('track-1', 'device-b')).toBe(false);
    });

    it('answers false for a strip this session did not claim', () => {
        sessionHolds({ carried: [], chains: { 'track-1': ['device-a'] } });

        expect(isDeviceCarriedByNativeSession('track-1', 'device-a')).toBe(false);
    });

    it('answers false for a claimed strip the session built no chain for', () => {
        sessionHolds({ carried: ['track-1'], chains: {} });

        expect(isDeviceCarriedByNativeSession('track-1', 'device-a')).toBe(false);
    });
});
