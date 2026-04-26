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

    it('returns 0 for envelope modulators (no time-based evaluation yet)', () => {
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
});
