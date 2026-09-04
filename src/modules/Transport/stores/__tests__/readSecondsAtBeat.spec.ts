import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { secondsBetweenBeats } from '../../models/TempoMap';
import { readSecondsAtBeat } from '../readSecondsAtBeat';
import { tempoMapStore } from '../tempoMapStore';
import { defaultTransportState, transportStore } from '../transportStore';

/** 120 BPM until beat 8, then 60. Beat 12 is 4 s + 4 s in. */
const STEPPED = [
    { id: 'tempo-a', beat: 0, tempo: 120, curve: 'instant' as const },
    { id: 'tempo-b', beat: 8, tempo: 60, curve: 'instant' as const },
];

/** A ramp, whose integral is a logarithm rather than a rectangle. */
const RAMPED = [
    { id: 'tempo-a', beat: 0, tempo: 120, curve: 'linear' as const },
    { id: 'tempo-b', beat: 8, tempo: 60, curve: 'instant' as const },
];

describe('readSecondsAtBeat', () => {
    beforeEach(() => {
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
    });

    afterEach(() => {
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
    });

    it('integrates the tempo map instead of dividing by the tempo in force', () => {
        tempoMapStore.set({ changes: STEPPED });

        // 8 beats at 120 BPM (4 s) then 4 at 60 (4 s). Dividing beat 12 by the
        // 60 BPM governing it reads 12 s; by the 120 it opened at, 6 s.
        expect(readSecondsAtBeat({ beat: 12 })).toBeCloseTo(8, 12);
    });

    it('reports exactly what secondsBetweenBeats reports, ramps included', () => {
        tempoMapStore.set({ changes: RAMPED });

        for (const beat of [0, 0.5, 4, 7.99, 8, 12.25]) {
            expect(readSecondsAtBeat({ beat })).toBe(secondsBetweenBeats(RAMPED, 0, beat, defaultTransportState.tempo));
        }
        // Guard the guard: a ramp must not read as the flat rate it starts at,
        // or the two agreeing above would prove nothing about the integration.
        expect(readSecondsAtBeat({ beat: 8 })).not.toBeCloseTo((8 / 120) * 60, 3);
    });

    it('falls back to the transport base tempo when there is no tempo map', () => {
        transportStore.set({ ...defaultTransportState, tempo: 90 });

        expect(readSecondsAtBeat({ beat: 9 })).toBeCloseTo(6, 12);
    });

    it('falls back to 120 BPM when there is no transport state to read', () => {
        transportStore.set(null);

        expect(readSecondsAtBeat({ beat: 4 })).toBeCloseTo(2, 12);
    });
});
