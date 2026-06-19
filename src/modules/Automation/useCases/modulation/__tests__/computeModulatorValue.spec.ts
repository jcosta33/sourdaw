import { describe, it, expect } from 'vitest';

import { type Modulator } from '../../../models/Modulator';
import { computeModulatorValue } from '../computeModulatorValue';

function lfo(overrides: Partial<Extract<Modulator['config'], { kind: 'lfo' }>> = {}): Modulator {
    return {
        id: 'x',
        name: 'x',
        trackId: 't',
        kind: 'lfo',
        config: {
            kind: 'lfo',
            waveform: 'sine',
            rate: 4,
            sync: true,
            phase: 0,
            depth: 1,
            ...overrides,
        },
        mappings: [],
        enabled: true,
    };
}

describe('computeModulatorValue', () => {
    it('computes a sine LFO centered at 0.5', () => {
        expect(computeModulatorValue(lfo(), 0)).toBeCloseTo(0.5);
        expect(computeModulatorValue(lfo(), 1)).toBeCloseTo(1);
        expect(computeModulatorValue(lfo(), 3)).toBeCloseTo(0);
    });

    it('scales an LFO by depth', () => {
        expect(computeModulatorValue(lfo({ depth: 0.5 }), 1)).toBeCloseTo(0.5);
    });

    it('returns the indexed step value', () => {
        const step: Modulator = {
            id: 's',
            name: 's',
            trackId: 't',
            kind: 'step',
            config: { kind: 'step', steps: [0, 1, 0.25], rate: 1, smooth: 0 },
            mappings: [],
            enabled: true,
        };
        expect(computeModulatorValue(step, 0.5)).toBe(0);
        expect(computeModulatorValue(step, 1.5)).toBe(1);
        expect(computeModulatorValue(step, 2.5)).toBe(0.25);
    });

    it('returns 0 for a step with no entries', () => {
        const step: Modulator = {
            id: 's',
            name: 's',
            trackId: 't',
            kind: 'step',
            config: { kind: 'step', steps: [], rate: 1, smooth: 0 },
            mappings: [],
            enabled: true,
        };
        expect(computeModulatorValue(step, 1)).toBe(0);
    });

    it('returns 0 for envelope modulators (kind is unsupported: no trigger/gate time in signature)', () => {
        const env: Modulator = {
            id: 'e',
            name: 'e',
            trackId: 't',
            kind: 'envelope',
            config: { kind: 'envelope', attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3, triggerMode: 'midi' },
            mappings: [],
            enabled: true,
        };
        expect(computeModulatorValue(env, 1)).toBe(0);
    });

    it('holds an LFO at DC when rate is 0 (period undefined) instead of a 1-beat period', () => {
        // Old `rate || 1` coercion ran a full 1-beat-period sine for a stopped LFO.
        expect(computeModulatorValue(lfo({ rate: 0 }), 0)).toBe(0);
        expect(computeModulatorValue(lfo({ rate: 0 }), 1)).toBe(0);
        expect(computeModulatorValue(lfo({ rate: 0 }), 2.5)).toBe(0);
    });

    it('holds a step modulator at its first step when rate is 0', () => {
        const step: Modulator = {
            id: 's',
            name: 's',
            trackId: 't',
            kind: 'step',
            config: { kind: 'step', steps: [0.7, 0.1, 0.9], rate: 0, smooth: 0 },
            mappings: [],
            enabled: true,
        };
        expect(computeModulatorValue(step, 0)).toBe(0.7);
        expect(computeModulatorValue(step, 5)).toBe(0.7);
    });

    it('produces a reproducible (host-independent) random LFO with sample-and-hold within a period', () => {
        const r = lfo({ waveform: 'random', rate: 2 });
        // Reproducible: the same cell yields the same value across calls.
        const a0 = computeModulatorValue(r, 0);
        const a1 = computeModulatorValue(r, 0);
        expect(a1).toBe(a0);
        // Sample-and-hold: the value is constant within one period (cell 0 = beats [0,2)).
        expect(computeModulatorValue(r, 0.5)).toBe(a0);
        expect(computeModulatorValue(r, 1.99)).toBe(a0);
        // A later cell generally differs from the first (not a flat constant).
        const cell2 = computeModulatorValue(r, 2);
        const cell4 = computeModulatorValue(r, 4);
        expect(cell2).not.toBe(cell4);
        // Output stays inside [0, depth].
        for (const beat of [0, 2, 4, 6, 8, 10]) {
            const v = computeModulatorValue(r, beat);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });
});
