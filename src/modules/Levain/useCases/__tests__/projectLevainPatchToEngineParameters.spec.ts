import { describe, expect, it } from 'vitest';

import { DEFAULT_MIC_POSITIONS, type LevainPatch, createDefaultPatch } from '../../models/LevainPatch';
import { projectLevainPatchToEngineParameters } from '../projectLevainPatchToEngineParameters';

describe('projectLevainPatchToEngineParameters', () => {
    it('projects the base patch fields onto engine parameter names', () => {
        const patch = createDefaultPatch('violin-1');
        const params = projectLevainPatchToEngineParameters(patch);
        const byName = new Map(params.map((p) => [p.name, p.value]));

        expect(byName.get('master_gain')).toBe(patch.masterGain);
        expect(byName.get('legato_enabled')).toBe(patch.legato.enabled ? 1 : 0);
        expect(byName.get('humanize_amount')).toBe(patch.humanize.amount);
        expect(byName.get('humanize_timing_max_ms')).toBe(patch.humanize.timingMaxMs);
        expect(byName.get('expression_vibrato_rate_min')).toBe(patch.expression.vibratoRateMin);
    });

    it('projects the current articulation as its numeric id', () => {
        const patch = createDefaultPatch('violin-1');
        const params = projectLevainPatchToEngineParameters(patch);
        const byName = new Map(params.map((p) => [p.name, p.value]));
        // The default articulation id should match what getArticulationId returns
        expect(byName.get('current_articulation')).toBeTypeOf('number');
    });

    it('emits 3 parameters per mic position (volume, pan, enabled)', () => {
        const patch: LevainPatch = {
            ...createDefaultPatch('violin-1'),
            micPositions: [
                { ...DEFAULT_MIC_POSITIONS[0]!, volume: 0.8, pan: 0.0, enabled: true },
                { ...DEFAULT_MIC_POSITIONS[1]!, volume: 0.4, pan: -0.5, enabled: false },
            ],
        };
        const params = projectLevainPatchToEngineParameters(patch);
        const byName = new Map(params.map((p) => [p.name, p.value]));

        // mic 0
        expect(byName.get('mic_0_volume')).toBe(0.8);
        expect(byName.get('mic_0_pan')).toBe(0.0);
        expect(byName.get('mic_0_enabled')).toBe(1);
        // mic 1
        expect(byName.get('mic_1_volume')).toBe(0.4);
        expect(byName.get('mic_1_pan')).toBe(-0.5);
        expect(byName.get('mic_1_enabled')).toBe(0);
    });

    it('omits mic parameters when micPositions is empty', () => {
        const patch: LevainPatch = {
            ...createDefaultPatch('violin-1'),
            micPositions: [],
        };
        const params = projectLevainPatchToEngineParameters(patch);
        const micParams = params.filter((p) => p.name.startsWith('mic_'));
        expect(micParams).toEqual([]);
    });
});
