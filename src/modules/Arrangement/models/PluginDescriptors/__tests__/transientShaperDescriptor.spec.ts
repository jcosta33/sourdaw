import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../DeviceParameter';
import { TRANSIENT_SHAPER_DESCRIPTOR } from '../TransientShaperDescriptor';

describe('public Transient Shaper descriptor', () => {
    it('publishes a generic stereo effect with exactly two linear gains and authored guidance', () => {
        const descriptor = getPluginById('transient-shaper');
        expect(descriptor).toBe(TRANSIENT_SHAPER_DESCRIPTOR);
        expect(descriptor).toMatchObject({
            name: 'Transient Shaper',
            format: 'builtin',
            category: 'effect',
            platform: 'both',
            hasCustomUI: false,
        });
        expect(
            descriptor?.parameters.map((p) => ({
                id: p.id,
                min: p.minValue,
                max: p.maxValue,
                initial: p.defaultValue,
                unit: p.unit,
                automatable: p.automatable,
            }))
        ).toEqual([
            { id: 'attackGain', min: 0, max: 2, initial: 1, unit: 'x', automatable: true },
            { id: 'sustainGain', min: 0, max: 2, initial: 1, unit: 'x', automatable: true },
        ]);
        expect(Object.keys(descriptor?.guidance?.parameters ?? {})).toEqual(['attackGain', 'sustainGain']);
        expect(descriptor?.capabilities).toMatchObject({
            audioProcessing: { availability: 'available' },
            instrumentGeneration: { availability: 'unavailable' },
            audioAnalysis: { availability: 'unavailable' },
            referenceSignalGeneration: { availability: 'unavailable' },
        });
        expect(JSON.stringify(descriptor?.guidance)).toContain('block-boundary step/hold');
        expect(JSON.stringify(descriptor?.guidance)).toContain('independently');
        expect(JSON.stringify(descriptor)).not.toContain('_resetEpoch');
    });
});
