import { describe, expect, it } from 'vitest';

import { analyzeMix } from '../analyzeMix';

function toneBuffer(frequencyHz: number, amplitude = 0.5, sampleRate = 48_000): AudioBuffer {
    const length = sampleRate;
    const data = new Float32Array(length);
    for (let position = 0; position < length; position++) {
        data[position] = amplitude * Math.sin((2 * Math.PI * frequencyHz * position) / sampleRate);
    }
    return {
        sampleRate,
        length,
        numberOfChannels: 1,
        getChannelData: () => data,
        duration: length / sampleRate,
    } as unknown as AudioBuffer;
}

describe('analyzeMix (program-audio measurement)', () => {
    it('should export analyzeMix', () => {
        expect(analyzeMix).toBeDefined();
        expect(typeof analyzeMix).toBe('function');
    });

    it('should refuse to produce numbers when it was given no program audio', () => {
        // The layout heuristic this test file once pinned derived dBFS values
        // from fader positions; issue #3841 removed that fabrication. Without
        // audio there is no measurement, whatever the track layout says.
        expect(analyzeMix()).toEqual({ status: 'unavailable', reason: 'no-program-audio' });
    });

    it('should convert actual samples to dBFS — the conversion contract this file guards', () => {
        // A 0.5-amplitude sine measures 20·log10(0.5) ≈ -6.02 dBFS peak and
        // 20·log10(0.5/√2) ≈ -9.03 dBFS RMS. The linear→dB conversion the
        // earlier repair introduced is now driven by samples, not faders.
        const result = analyzeMix([toneBuffer(220)]);

        if (result.status !== 'measured') {
            throw new Error('Expected a measured result');
        }
        expect(result.analysis.peakDb).toBeCloseTo(-6.0206, 3);
        expect(result.analysis.rmsDb).toBeCloseTo(-9.0309, 3);
        expect(result.analysis.peakDb).toBeGreaterThan(result.analysis.rmsDb);
    });

    it('should report silence as unavailable instead of a floored measurement', () => {
        const silence = new Float32Array(48_000);
        const buffer = {
            sampleRate: 48_000,
            length: silence.length,
            numberOfChannels: 1,
            getChannelData: () => silence,
            duration: 1,
        } as unknown as AudioBuffer;

        expect(analyzeMix([buffer])).toEqual({ status: 'unavailable', reason: 'silent-program-audio' });
    });
});
