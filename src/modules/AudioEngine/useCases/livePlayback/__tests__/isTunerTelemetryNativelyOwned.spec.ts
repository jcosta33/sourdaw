/**
 * The predicate the composition root reads before it lets either of the
 * Tuner's two analysers publish (#3124).
 *
 * Both halves are load-bearing, and each one alone puts a reading the musician
 * is not hearing in front of them. Chain membership alone would hand the panel
 * a shadowed session's zeros — that graph renders into a monitor nobody hears,
 * so its analyser reads silence while the player plays. Audibility alone would
 * claim every tuner in the project for the engine, including one on a strip
 * Web Audio still owns and one the mapper degraded, and those have no native
 * body publishing for them at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { isTunerTelemetryNativelyOwned } from '../isTunerTelemetryNativelyOwned';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';

function sessionHolds(input: {
    audible: boolean;
    carried: readonly string[];
    chains: Record<string, readonly string[]>;
}): void {
    nativeLiveGraphSession.audibleCarrier = input.audible;
    nativeLiveGraphSession.carriedStripIds = new Set(input.carried);
    nativeLiveGraphSession.nativeChainByStripId = new Map(Object.entries(input.chains));
}

describe('isTunerTelemetryNativelyOwned', () => {
    beforeEach(() => {
        sessionHolds({ audible: false, carried: [], chains: {} });
    });

    it('answers true for a device in the reported chain of a carried strip of an audible session', () => {
        sessionHolds({
            audible: true,
            carried: ['track-1', 'track-2'],
            chains: { 'track-1': ['d-eq'], 'track-2': ['d-tuner'] },
        });

        expect(isTunerTelemetryNativelyOwned('d-tuner')).toBe(true);
    });

    it('answers false while the session is shadowed, because Web Audio is what is heard', () => {
        sessionHolds({ audible: false, carried: ['track-1'], chains: { 'track-1': ['d-tuner'] } });

        expect(isTunerTelemetryNativelyOwned('d-tuner')).toBe(false);
    });

    it('answers false for a device on a strip this session did not carry', () => {
        sessionHolds({ audible: true, carried: ['track-1'], chains: { 'track-2': ['d-tuner'] } });

        expect(isTunerTelemetryNativelyOwned('d-tuner')).toBe(false);
    });

    it('answers false for a device no carried chain reports, even on a carried strip', () => {
        sessionHolds({ audible: true, carried: ['track-1'], chains: { 'track-1': ['d-eq'] } });

        expect(isTunerTelemetryNativelyOwned('d-tuner')).toBe(false);
    });
});
