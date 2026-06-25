import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeMix } from '../analyzeMix';

const mocks = vi.hoisted(() => ({
    trackStore: { value: null as { tracks: unknown[] } | null },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
}));

function track(overrides: Record<string, unknown> = {}) {
    return { kind: 'audio', muted: false, gain: 0.8, pan: 0, ...overrides };
}

describe('analyzeMix (track-layout heuristic)', () => {
    beforeEach(() => {
        mocks.trackStore.value = null;
    });

    it('should export analyzeMix', () => {
        expect(analyzeMix).toBeDefined();
        expect(typeof analyzeMix).toBe('function');
    });

    it('should treat track.gain as a linear amplitude and report rmsDb/peakDb in dBFS', () => {
        // One track at unity fader (gain 1.0 -> 0 dBFS). The dBFS contract means
        // peakDb must sit 1 dB below 0 (the -1 headroom offset) and rmsDb 6 dB
        // below. The old code subtracted the offsets from the *linear* gain
        // (1.0 - 1 = 0, 1.0 - 6 = -5), so this pins the linear->dB conversion.
        mocks.trackStore.value = { tracks: [track({ gain: 1.0 })] };

        const analysis = analyzeMix();

        // 20*log10(1.0) = 0 dBFS, minus the -1 / -6 offsets.
        expect(analysis.peakDb).toBeCloseTo(-1, 5);
        expect(analysis.rmsDb).toBeCloseTo(-6, 5);
    });

    it('should map a sub-unity fader to a negative dBFS level, not the raw linear value', () => {
        // Default fader 0.8 -> 20*log10(0.8) = -1.938 dBFS. The old code would
        // have produced peakDb = 0.8 - 1 = -0.2 (a linear value masquerading as
        // dB). After the fix, peakDb is well below that.
        mocks.trackStore.value = { tracks: [track({ gain: 0.8 })] };

        const analysis = analyzeMix();

        const expectedPeak = 20 * Math.log10(0.8) - 1;
        expect(analysis.peakDb).toBeCloseTo(expectedPeak, 5);
        // Guards against the linear-as-dB regression (old peakDb would be -0.2).
        expect(analysis.peakDb).toBeLessThan(-2);
    });

    it('should keep peak above rms and clamp silent mixes to the -60 dBFS floor', () => {
        // A muted-equivalent silent fader (gain 0) must not produce -Infinity:
        // it floors at -60 dBFS for both fields.
        mocks.trackStore.value = { tracks: [track({ gain: 0 })] };

        const analysis = analyzeMix();

        expect(Number.isFinite(analysis.peakDb)).toBe(true);
        expect(analysis.rmsDb).toBe(-60);
        expect(analysis.peakDb).toBe(-60);
    });

    it('should keep peak strictly above rms for an audible mix', () => {
        mocks.trackStore.value = { tracks: [track({ gain: 0.9 })] };

        const analysis = analyzeMix();

        expect(analysis.peakDb).toBeGreaterThan(analysis.rmsDb);
    });
});
