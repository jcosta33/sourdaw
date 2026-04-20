import { describe, it, expect } from 'vitest';

import { readFrequencyBalance } from '../readFrequencyBalance';

describe('readFrequencyBalance', () => {
    it('returns silence floor when given flat/empty data', () => {
        const mockAnalyser = {
            frequencyBinCount: 1024,
            context: { sampleRate: 48000 },
            getFloatFrequencyData: (data: Float32Array) => {
                data.fill(-100);
            },
        } as unknown as AnalyserNode;

        const bands = readFrequencyBalance(mockAnalyser);

        expect(bands.sub).toBeCloseTo(-100);
        expect(bands.bass).toBeCloseTo(-100);
        expect(bands.lowMid).toBeCloseTo(-100);
        expect(bands.mid).toBeCloseTo(-100);
        expect(bands.highMid).toBeCloseTo(-100);
        expect(bands.high).toBeCloseTo(-100);
    });

    it('calculates average db level for different frequency bands', () => {
        const mockAnalyser = {
            frequencyBinCount: 1024,
            context: { sampleRate: 48000 },
            getFloatFrequencyData: (data: Float32Array) => {
                // Mock different levels for different bins
                // Bin width = 48000 / (1024 * 2) = ~23.43 Hz per bin
                // Sub (20-60): bins ~1 to 3
                data.fill(-20, 1, 3);
                // Mid (500-2000): bins ~21 to 85
                data.fill(-10, 21, 85);
                // Fill the rest with silence
                for (let i = 0; i < data.length; i++) {
                    if ((i < 1 || i >= 3) && (i < 21 || i >= 85)) {
                        data[i] = -100;
                    }
                }
            },
        } as unknown as AnalyserNode;

        const bands = readFrequencyBalance(mockAnalyser);

        expect(bands.sub).toBeGreaterThan(-100);
        expect(bands.mid).toBeGreaterThan(-100);
        // High band should be silent since we filled it with -100
        expect(bands.high).toBeCloseTo(-100);
    });
});
