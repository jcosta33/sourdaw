import { describe, expect, it } from 'vitest';

import { getLevainProjectParameterId } from '../getLevainProjectParameterId';

describe('getLevainProjectParameterId', () => {
    it('returns the override for humanize_amount', () => {
        expect(getLevainProjectParameterId('humanize_amount')).toBe('humanize');
    });

    it('converts snake_case to camelCase', () => {
        expect(getLevainProjectParameterId('attack_time')).toBe('attackTime');
        expect(getLevainProjectParameterId('filter_cutoff')).toBe('filterCutoff');
        expect(getLevainProjectParameterId('sub_osc_level')).toBe('subOscLevel');
    });

    it('handles single-word names and already-camelCase input unchanged', () => {
        expect(getLevainProjectParameterId('gain')).toBe('gain');
        expect(getLevainProjectParameterId('masterGain')).toBe('masterGain');
    });

    it('converts snake_case with numeric segments', () => {
        expect(getLevainProjectParameterId('osc_2_level')).toBe('osc2Level');
        expect(getLevainProjectParameterId('lfo_1_rate')).toBe('lfo1Rate');
    });
});
