import { describe, it, expect } from 'vitest';

import { readLevels } from '../readLevels';

describe('readLevels', () => {
    it('returns silence floor for empty array', () => {
        const mockAnalyser = {
            frequencyBinCount: 1024,
            getFloatTimeDomainData: (data: Float32Array) => {
                data.fill(0);
            },
        } as unknown as AnalyserNode;

        const levels = readLevels(mockAnalyser);

        expect(levels.peakDb).toBe(-100);
        expect(levels.rmsDb).toBe(-100);
    });

    it('calculates correct peak and rms for constant signal', () => {
        const mockAnalyser = {
            frequencyBinCount: 1024,
            getFloatTimeDomainData: (data: Float32Array) => {
                // Fill with 0.5 (which is -6.02 dB)
                data.fill(0.5);
            },
        } as unknown as AnalyserNode;

        const levels = readLevels(mockAnalyser);

        expect(levels.peakDb).toBeCloseTo(-6.02, 1);
        expect(levels.rmsDb).toBeCloseTo(-6.02, 1);
    });

    it('calculates correct peak and rms for varying signal', () => {
        const mockAnalyser = {
            frequencyBinCount: 4,
            getFloatTimeDomainData: (data: Float32Array) => {
                data[0] = 0.1;
                data[1] = -0.5; // absolute peak is 0.5
                data[2] = 0.2;
                data[3] = 0.0;
            },
        } as unknown as AnalyserNode;

        const levels = readLevels(mockAnalyser);

        // Peak = 0.5 -> -6.02 dB
        expect(levels.peakDb).toBeCloseTo(-6.02, 1);

        // RMS = sqrt((0.01 + 0.25 + 0.04 + 0) / 4) = sqrt(0.3 / 4) = sqrt(0.075) ≈ 0.2738
        // 20 * log10(0.2738) ≈ -11.25 dB
        expect(levels.rmsDb).toBeCloseTo(-11.25, 1);
    });
});
