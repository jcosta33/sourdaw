import { describe, it, expect, vi } from 'vitest';

import { applyCompressorParams } from '../dynamics/applyCompressorParams';
import { applyEqParams } from '../dynamics/applyEqParams';
import { applyFilterParams } from '../toneShaping/applyFilterParams';
import { applyGainParams } from '../toneShaping/applyGainParams';

function createMockParam(initial = 0) {
    return { value: initial };
}

describe('deviceParameterAppliers', () => {
    describe('applyGainParams', () => {
        it('should apply gain in dB and convert to linear', () => {
            const gainNode = { gain: createMockParam(1) };
            const dn = { nodes: [gainNode], input: {} as any, output: {} as any };

            // 0dB = 1.0
            applyGainParams(dn as any, { 'gain-level': 0 });
            expect(gainNode.gain.value).toBe(1.0);

            // -6dB approx 0.5
            applyGainParams(dn as any, { 'gain-level': -6.020599913279624 });
            expect(gainNode.gain.value).toBeCloseTo(0.5, 5);
        });
    });

    describe('applyFilterParams', () => {
        it('should apply cutoff, resonance and type', () => {
            const filterNode = {
                frequency: createMockParam(1000),
                Q: createMockParam(1),
                type: 'lowpass',
            };
            const dn = { nodes: [filterNode], input: {} as any, output: {} as any };

            applyFilterParams(dn as any, {
                'filter-cutoff': 2000,
                'filter-resonance': 5,
                'filter-type': 1, // highpass
            });

            expect(filterNode.frequency.value).toBe(2000);
            expect(filterNode.Q.value).toBe(5);
            expect(filterNode.type).toBe('highpass');
        });
    });

    describe('applyCompressorParams', () => {
        it('should apply compressor settings and makeup gain', () => {
            const compNode = {
                threshold: createMockParam(0),
                ratio: createMockParam(1),
                attack: createMockParam(0),
                release: createMockParam(0),
                knee: createMockParam(0),
            };
            const makeupNode = { gain: createMockParam(1) };
            const dn = { nodes: [compNode, makeupNode], input: {} as any, output: {} as any };

            applyCompressorParams(dn as any, {
                'comp-threshold': -20,
                'comp-ratio': 4,
                'comp-attack': 10, // 10ms -> 0.01s
                'comp-release': 100, // 100ms -> 0.1s
                'comp-knee': 12,
                'comp-makeup': 6, // +6dB -> approx 2.0
            });

            expect(compNode.threshold.value).toBe(-20);
            expect(compNode.ratio.value).toBe(4);
            expect(compNode.attack.value).toBe(0.01);
            expect(compNode.release.value).toBe(0.1);
            expect(compNode.knee.value).toBe(12);
            expect(makeupNode.gain.value).toBeCloseTo(1.995, 2);
        });
    });

    describe('applyEqParams', () => {
        it('should apply EQ bands', () => {
            const low = { gain: createMockParam(0), frequency: createMockParam(100), Q: createMockParam(1) };
            const mid = { gain: createMockParam(0), frequency: createMockParam(1000), Q: createMockParam(1) };
            const high = { gain: createMockParam(0), frequency: createMockParam(10000), Q: createMockParam(1) };
            const dn = { nodes: [low, mid, high], input: {} as any, output: {} as any };

            applyEqParams(dn as any, {
                'eq-low-gain': 3,
                'eq-mid-freq': 500,
                'eq-high-q': 0.5,
            });

            expect(low.gain.value).toBe(3);
            expect(mid.frequency.value).toBe(500);
            expect(high.Q.value).toBe(0.5);
        });
    });
});
