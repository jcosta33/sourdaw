import { describe, expect, it } from 'vitest';

import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { DEFAULT_BAND, DEFAULT_PATCH } from '../../../models/BacteriaPatch';
import { BACTERIA_PRESETS } from '../../bacteriaPresets';
import { bacteriaFactoryParameters } from '../bacteriaFactoryParameters';

function bitcrushValues(): Record<string, number> {
    const preset = BACTERIA_PRESETS.find(({ id }) => id === 'bac-bitcrush-cascade');
    if (!preset) {
        throw new Error('Expected a Bitcrush Cascade factory preset');
    }
    return bacteriaFactoryParameters.presetValues(preset.patch);
}

describe('Bacteria factory preset parameters', () => {
    it('captures dormant overrides only when the preset activates their bands', () => {
        const desired = bitcrushValues();
        const capture = bacteriaFactoryParameters.captureValues(
            {
                bandCount: 1,
                bitDepth: 11,
                band4_bitDepth: 13,
                band2_bitDepth: 21,
                crossoverFreq3: 2500,
                crossoverFreq4: 7100,
            },
            desired
        );

        expect(capture).toMatchObject({
            before: { bandCount: 1, bitDepth: 11, band2_bitDepth: 21 },
            after: { bandCount: 3, bitDepth: 11, band0_bitDepth: 12, band1_bitDepth: 8, band2_bitDepth: 4 },
        });
        expect(capture.before).not.toHaveProperty('band4_bitDepth');
        expect(capture.after).not.toHaveProperty('band4_bitDepth');
        expect(capture.after).not.toHaveProperty('crossoverFreq3');
        expect(capture.after).not.toHaveProperty('crossoverFreq4');
        expect(desired).not.toHaveProperty('crossoverFreq4');
        expect(desired).toHaveProperty('band2_convolutionIr', -1);
        expect(desired).not.toHaveProperty('name');
        expect(desired).not.toHaveProperty('modAssignments');
    });

    it('replays an unchanged explicit leaf when its dormant band becomes active', () => {
        const desired = bitcrushValues();
        const capture = bacteriaFactoryParameters.captureValues({ bandCount: 1, band2_bitDepth: 4 }, desired);

        expect(capture.before).toHaveProperty('band2_bitDepth', 4);
        expect(capture.after).toHaveProperty('band2_bitDepth', 4);
        expect(bacteriaFactoryParameters.replayValues(capture.before, capture.after)).toHaveProperty(
            'band2_bitDepth',
            4
        );
        expect(bacteriaFactoryParameters.replayValues(capture.after, capture.before)).not.toHaveProperty(
            'band2_bitDepth'
        );
    });

    it.each([
        { inherited: 11, restored: 11 },
        { inherited: null, restored: 16 },
    ])('restores a missing prefixed leaf to $restored without replaying the bare key', ({ inherited, restored }) => {
        const desired = bitcrushValues();
        const ids = bacteriaFactoryParameters.capturedIds(desired);
        expect(ids).toContain('bitDepth');
        const capture = bacteriaFactoryParameters.captureValues({ bandCount: 1, bitDepth: inherited }, desired);

        expect(capture.before).toHaveProperty('band2_bitDepth', null);
        expect(bacteriaFactoryParameters.replayValues(capture.before, capture.after)).toHaveProperty(
            'band2_bitDepth',
            4
        );
        const undo = bacteriaFactoryParameters.replayValues(capture.after, capture.before);
        expect(undo).toHaveProperty('band2_bitDepth', restored);
        expect(undo).not.toHaveProperty('bitDepth');
    });

    it('encodes sync, an explicit freeze reset, and discrete body values through one footprint', () => {
        const desired = bacteriaFactoryParameters.presetValues({
            ...DEFAULT_PATCH,
            lfo1Sync: true,
            lfo2Sync: true,
            bands: [{ ...DEFAULT_BAND, convolutionIr: 'metal' }, ...DEFAULT_PATCH.bands.slice(1)],
        });
        const capture = bacteriaFactoryParameters.captureValues(
            { band0_convolutionIr: 1, band0_grainFreeze: 1, outputGain: DEFAULT_PATCH.outputGain },
            desired
        );

        expect(capture.after).toEqual({
            lfo1Sync: 1,
            lfo2Sync: 1,
            band0_grainFreeze: 0,
            grainFreeze: null,
            band0_convolutionIr: 2,
            convolutionIr: null,
        });
        expect(bacteriaFactoryParameters.replayValues(capture.after, capture.before)).toEqual({
            lfo1Sync: 0,
            lfo2Sync: 0,
            band0_grainFreeze: 1,
            band0_convolutionIr: 1,
        });
    });

    it.each(BACTERIA_PRESETS)('authors $name within the descriptor law', ({ patch }) => {
        const entries = Object.entries(bacteriaFactoryParameters.presetValues(patch));
        const outsideRange = entries.filter(
            ([paramId, value]) => clampDeviceParameterValue({ deviceType: 'bacteria', paramId, value }) !== value
        );
        expect(outsideRange).toEqual([]);
    });
});
