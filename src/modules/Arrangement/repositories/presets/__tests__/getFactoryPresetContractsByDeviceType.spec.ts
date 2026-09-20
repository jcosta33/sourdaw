import { describe, expect, it } from 'vitest';

import { type SoundPreset } from '../../../models/SoundPreset';
import { getFactoryPresetContractsByDeviceType } from '../getFactoryPresetContractsByDeviceType';

const preset: SoundPreset = {
    id: 'character-fixture',
    name: 'Character Fixture',
    category: 'fx',
    subcategory: 'reverb',
    description: 'A fixture whose owner content changes without changing its identity.',
    trackKind: 'audio',
    devices: [
        {
            type: 'builtin-reverb',
            name: 'Fixture Reverb',
            parameterValues: { 'rev-decay': 1.2, 'rev-mix': 0.3 },
        },
    ],
    tags: ['room'],
    author: 'Test',
    isFactory: true,
};

function contractFor(value: SoundPreset) {
    const contract = getFactoryPresetContractsByDeviceType([value], ['builtin-reverb'])[0];
    if (!contract) {
        throw new Error('Expected a factory preset contract.');
    }
    return contract;
}

describe('factory preset discovery contract', () => {
    it('reversions retained preset identities when descriptive or parameter content changes', () => {
        const original = contractFor(preset);
        const equivalent = contractFor({
            ...preset,
            devices: [
                {
                    ...preset.devices[0]!,
                    parameterValues: { 'rev-mix': 0.3, 'rev-decay': 1.2 },
                },
            ],
        });
        const metadataChanged = contractFor({ ...preset, tags: ['hall'] });
        const parameterChanged = contractFor({
            ...preset,
            devices: [{ ...preset.devices[0]!, parameterValues: { 'rev-decay': 3.4, 'rev-mix': 0.3 } }],
        });

        expect(equivalent.presetVersion).toBe(original.presetVersion);
        expect(metadataChanged.identities).toEqual(original.identities);
        expect(parameterChanged.identities).toEqual(original.identities);
        expect(metadataChanged.presetVersion).not.toBe(original.presetVersion);
        expect(parameterChanged.presetVersion).not.toBe(original.presetVersion);
    });
});
