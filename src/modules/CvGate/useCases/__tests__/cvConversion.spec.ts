import { describe, it, expect, vi } from 'vitest';

vi.mock('../../stores/cvGate', () => ({
    cvGateStore: { value: { voltageStandard: '1v-per-octave' as const } },
}));

import { cvGateStore } from '../../stores/cvGate';
import { midiNoteToCv } from '../cvConversion/midiNoteToCv';

describe('cvConversion', () => {
    it('midiNoteToCv uses 1V/oct when voltage standard is 1v-per-octave (C0=0V)', () => {
        // C0 = MIDI 24 → 0V; C1 = 36 → 1V; A4 = 69 → 45/12V
        expect(midiNoteToCv(24)).toBe(0);
        expect(midiNoteToCv(36)).toBe(1);
        expect(midiNoteToCv(48)).toBe(2);
    });

    it('midiNoteToCv switches to Hz/V when standard != 1v-per-octave', () => {
        // @ts-expect-error - mutating mock value
        cvGateStore.value = { voltageStandard: 'hz-per-volt' };
        expect(midiNoteToCv(69)).toBeCloseTo(440);
        expect(midiNoteToCv(81)).toBeCloseTo(880);
    });

    it('midiNoteToCv returns 0 when store is null', () => {
        // @ts-expect-error - mutating mock value
        cvGateStore.value = null;
        expect(midiNoteToCv(60)).toBe(0);
    });
});
