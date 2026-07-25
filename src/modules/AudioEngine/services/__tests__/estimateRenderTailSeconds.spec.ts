import { describe, it, expect } from 'vitest';

import { estimateRenderTailSeconds } from '../estimateRenderTailSeconds';

describe('estimateRenderTailSeconds', () => {
    it('returns 0 when no tracks have reverb or delay devices', () => {
        const result = estimateRenderTailSeconds([
            { devices: [{ type: 'builtin-eq', parameterValues: {}, bypassed: false }] },
        ]);
        expect(result).toBe(0);
    });

    it('uses the reverb rev-decay parameter as the tail estimate', () => {
        const result = estimateRenderTailSeconds([
            { devices: [{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 4.5 }, bypassed: false }] },
        ]);
        expect(result).toBe(4.5);
    });

    it('ignores bypassed devices', () => {
        const result = estimateRenderTailSeconds([
            { devices: [{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 8 }, bypassed: true }] },
        ]);
        expect(result).toBe(0);
    });

    it('picks the longest tail across tracks', () => {
        const result = estimateRenderTailSeconds([
            { devices: [{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 2 }, bypassed: false }] },
            { devices: [{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 6 }, bypassed: false }] },
        ]);
        expect(result).toBe(6);
    });

    it('estimates delay tail from delay-time and feedback using exponential decay to -60 dB', () => {
        const delayTimeMs = 500;
        const feedback = 0.5;
        const expected = (delayTimeMs / 1000) * (Math.log(0.001) / Math.log(feedback));
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-delay',
                        parameterValues: { 'delay-time': delayTimeMs, 'delay-feedback': feedback },
                        bypassed: false,
                    },
                ],
            },
        ]);
        expect(result).toBeCloseTo(expected, 3);
    });

    it('caps at 30 seconds', () => {
        const result = estimateRenderTailSeconds([
            { devices: [{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 100 }, bypassed: false }] },
        ]);
        expect(result).toBe(30);
    });

    it('ignores delays with zero feedback', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-delay',
                        parameterValues: { 'delay-time': 500, 'delay-feedback': 0 },
                        bypassed: false,
                    },
                ],
            },
        ]);
        expect(result).toBe(0);
    });
});
