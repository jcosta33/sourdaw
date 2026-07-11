import { describe, expect, it } from 'vitest';

import { getSynthParamsFromDevices } from '../getSynthParamsFromDevices';

describe('getSynthParamsFromDevices', () => {
    it('should return complete defaults when no synth device exists', () => {
        expect(getSynthParamsFromDevices([])).toEqual({
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
        });
    });

    it('should resolve numeric enum values and preserve numeric parameters', () => {
        const result = getSynthParamsFromDevices([
            {
                type: 'builtin-synth-poly',
                parameterValues: {
                    waveform: 3,
                    osc2Waveform: 0,
                    filterType: 1,
                    attack: 0.25,
                    gain: 0.8,
                },
            },
        ]);

        expect(result).toMatchObject({
            waveform: 'square',
            osc2Waveform: 'sine',
            filterType: 'highpass',
            attack: 0.25,
            gain: 0.8,
        });
    });
});
