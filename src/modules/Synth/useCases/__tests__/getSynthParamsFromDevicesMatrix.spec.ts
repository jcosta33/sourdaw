import { describe, it, expect } from 'vitest';

import { getSynthParamsFromDevices } from '../getSynthParamsFromDevices';

/**
 * resolveEnumParam is a private function with 4 branches: undefined→fallback,
 * validString→string, validNumber→indexed, invalid/outOfRange→fallback.
 * These specs exercise each branch for waveform, osc2Waveform, and filterType,
 * plus the first-device-wins behavior and numeric-param pass-through.
 */

const DEFAULTS = {
    waveform: 'sawtooth',
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    filterCutoff: 5000,
    filterResonance: 1,
    filterType: 'lowpass',
    filterEnvAmount: 0,
    detune: 0,
    gain: 0.3,
    osc2Waveform: 'sawtooth',
    osc2Detune: 0,
    osc2Mix: 0,
    subOscLevel: 0,
    noiseLevel: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    vibratoDelay: 0.3,
    stereoSpread: 0,
    filterVelocitySensitivity: 0,
} as const;

function synth(pv: Record<string, number>): Parameters<typeof getSynthParamsFromDevices>[0] {
    return [{ type: 'builtin-synth-poly', parameterValues: pv }];
}

describe('getSynthParamsFromDevices — waveform resolveEnumParam branches', () => {
    it('resolves a valid string waveform directly', () => {
        const result = getSynthParamsFromDevices(synth({ waveform: 'square' as unknown as number }));
        expect(result.waveform).toBe('square');
    });

    it('resolves a valid numeric index to the indexed waveform', () => {
        const result = getSynthParamsFromDevices(synth({ waveform: 1 }));
        expect(result.waveform).toBe('triangle');
    });

    it('falls back to default for an out-of-range numeric index (e.g. 99)', () => {
        const result = getSynthParamsFromDevices(synth({ waveform: 99 }));
        expect(result.waveform).toBe(DEFAULTS.waveform);
    });

    it('falls back to default for an invalid string waveform', () => {
        const result = getSynthParamsFromDevices(synth({ waveform: 'saw' as unknown as number }));
        expect(result.waveform).toBe(DEFAULTS.waveform);
    });

    it('preserves default when waveform key is absent from parameterValues', () => {
        const result = getSynthParamsFromDevices(synth({ gain: 0.5 }));
        expect(result.waveform).toBe(DEFAULTS.waveform);
    });
});

describe('getSynthParamsFromDevices — osc2Waveform resolveEnumParam branches', () => {
    it('resolves a valid string osc2Waveform', () => {
        const result = getSynthParamsFromDevices(synth({ osc2Waveform: 'sine' as unknown as number }));
        expect(result.osc2Waveform).toBe('sine');
    });

    it('resolves a valid numeric index for osc2Waveform', () => {
        const result = getSynthParamsFromDevices(synth({ osc2Waveform: 3 }));
        expect(result.osc2Waveform).toBe('square');
    });

    it('falls back to default for out-of-range osc2Waveform index', () => {
        const result = getSynthParamsFromDevices(synth({ osc2Waveform: 50 }));
        expect(result.osc2Waveform).toBe(DEFAULTS.osc2Waveform);
    });

    it('falls back to default for invalid osc2Waveform string', () => {
        const result = getSynthParamsFromDevices(synth({ osc2Waveform: 'noise' as unknown as number }));
        expect(result.osc2Waveform).toBe(DEFAULTS.osc2Waveform);
    });
});

describe('getSynthParamsFromDevices — filterType resolveEnumParam branches', () => {
    it('resolves a valid string filterType', () => {
        const result = getSynthParamsFromDevices(synth({ filterType: 'bandpass' as unknown as number }));
        expect(result.filterType).toBe('bandpass');
    });

    it('resolves a valid numeric index for filterType', () => {
        const result = getSynthParamsFromDevices(synth({ filterType: 2 }));
        expect(result.filterType).toBe('bandpass');
    });

    it('falls back to default for out-of-range filterType index', () => {
        const result = getSynthParamsFromDevices(synth({ filterType: 7 }));
        expect(result.filterType).toBe(DEFAULTS.filterType);
    });

    it('falls back to default for invalid filterType string', () => {
        const result = getSynthParamsFromDevices(synth({ filterType: 'notch' as unknown as number }));
        expect(result.filterType).toBe(DEFAULTS.filterType);
    });
});

describe('getSynthParamsFromDevices — numeric parameter pass-through', () => {
    it('passes through all numeric params and preserves non-provided defaults', () => {
        const result = getSynthParamsFromDevices(
            synth({
                attack: 0.5,
                decay: 0.3,
                sustain: 0.9,
                release: 1.2,
                filterCutoff: 800,
                filterResonance: 5,
                detune: 7,
                gain: 0.75,
                osc2Detune: -12,
                osc2Mix: 0.5,
                subOscLevel: 0.3,
                noiseLevel: 0.1,
                vibratoRate: 5,
                vibratoDepth: 0.2,
                vibratoDelay: 0.1,
                stereoSpread: 0.4,
                filterEnvAmount: 0.8,
                filterVelocitySensitivity: 0.6,
            })
        );
        expect(result.attack).toBe(0.5);
        expect(result.decay).toBe(0.3);
        expect(result.sustain).toBe(0.9);
        expect(result.release).toBe(1.2);
        expect(result.filterCutoff).toBe(800);
        expect(result.filterResonance).toBe(5);
        expect(result.detune).toBe(7);
        expect(result.gain).toBe(0.75);
        expect(result.osc2Detune).toBe(-12);
        expect(result.osc2Mix).toBe(0.5);
        expect(result.subOscLevel).toBe(0.3);
        expect(result.noiseLevel).toBe(0.1);
        expect(result.vibratoRate).toBe(5);
        expect(result.vibratoDepth).toBe(0.2);
        expect(result.vibratoDelay).toBe(0.1);
        expect(result.stereoSpread).toBe(0.4);
        expect(result.filterEnvAmount).toBe(0.8);
        expect(result.filterVelocitySensitivity).toBe(0.6);
    });
});

describe('getSynthParamsFromDevices — device selection', () => {
    it('picks the first builtin synth device when multiple exist', () => {
        const result = getSynthParamsFromDevices([
            { type: 'builtin-synth-poly', parameterValues: { gain: 0.1 } },
            { type: 'builtin-synth-mono', parameterValues: { gain: 0.9 } },
        ]);
        // First device's params win.
        expect(result.gain).toBe(0.1);
    });

    it('ignores non-synth devices and finds the synth among them', () => {
        const result = getSynthParamsFromDevices([
            { type: 'fermenter', parameterValues: { gain: 0.99 } },
            { type: 'toaster', parameterValues: { gain: 0.99 } },
            { type: 'builtin-synth-poly', parameterValues: { gain: 0.42 } },
        ]);
        expect(result.gain).toBe(0.42);
    });

    it('returns a fresh defaults object (not a shared reference) when no synth device', () => {
        const a = getSynthParamsFromDevices([]);
        const b = getSynthParamsFromDevices([]);
        a.gain = 99;
        // Each call returns an independent copy.
        expect(b.gain).toBe(DEFAULTS.gain);
    });
});

describe('getSynthParamsFromDevices — mixed enum + numeric in one device', () => {
    it('resolves all three enums and passes through numerics simultaneously', () => {
        const result = getSynthParamsFromDevices(
            synth({
                waveform: 0,
                osc2Waveform: 2,
                filterType: 1,
                attack: 0.15,
                gain: 0.6,
                filterCutoff: 3000,
            })
        );
        expect(result.waveform).toBe('sine');
        expect(result.osc2Waveform).toBe('sawtooth');
        expect(result.filterType).toBe('highpass');
        expect(result.attack).toBe(0.15);
        expect(result.gain).toBe(0.6);
        expect(result.filterCutoff).toBe(3000);
        // Untouched keys keep defaults.
        expect(result.release).toBe(DEFAULTS.release);
        expect(result.detune).toBe(DEFAULTS.detune);
    });
});
