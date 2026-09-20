import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getStableContractFingerprint } from '../../models/GetStableContractFingerprint';
import { getAgentPresetDiscoveryManifest } from '../getAgentPresetDiscoveryManifest';
import { getUserPresets } from '../preset/presetStorage/getUserPresets';
import { userPresetStorage } from '../preset/presetStorage/helpers';
import { saveUserPreset } from '../preset/presetStorage/saveUserPreset';

describe('getAgentPresetDiscoveryManifest', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('bounds receipt evidence while retaining full source matching terms and fingerprints', () => {
        const preset = saveUserPreset({
            name: 'n'.repeat(600),
            category: 'fx',
            description: 'x'.repeat(17_000),
            trackKind: 'audio',
            devices: [
                { type: 'builtin-distortion', name: 'Distortion', parameterValues: {} },
                ...Array.from({ length: 9 }, (_, index) => ({
                    type: `device-${String(index)}-${'d'.repeat(600)}`,
                    name: `Device ${String(index)}`,
                    parameterValues: {},
                })),
            ],
            tags: [
                ...Array.from({ length: 8 }, (_, index) => `ordinary-tag-${String(index)}`),
                'warm',
                'tube',
                ...Array.from({ length: 9 }, (_, index) => `tag-${String(index)}-${'t'.repeat(600)}`),
            ],
        });
        const before = getAgentPresetDiscoveryManifest().find((entry) => entry.id === preset.id);
        const changed = { ...preset, description: `${'x'.repeat(16_999)}y` };

        userPresetStorage.set([changed]);
        const after = getAgentPresetDiscoveryManifest().find((entry) => entry.id === preset.id);

        expect(getUserPresets()).toEqual([changed]);
        expect(before).toMatchObject({
            id: preset.id,
            name: 'n'.repeat(128),
            description: 'x'.repeat(1_024),
            tags: [...Array.from({ length: 8 }, (_, index) => `ordinary-tag-${String(index)}`), 'tube'],
            deviceTypes: [
                'builtin-distortion',
                ...Array.from({ length: 7 }, (_, index) => `device-${String(index)}-${'d'.repeat(119)}`),
            ],
            searchTerms: [preset.name, ...preset.tags],
            version: `preset-v1:${getStableContractFingerprint(preset)}`,
        });
        expect(before?.tags).not.toContain('warm');
        expect(before).not.toHaveProperty('characterTags');
        expect(after?.description).toBe(before?.description);
        expect(after?.version).toBe(`preset-v1:${getStableContractFingerprint(changed)}`);
        expect(after?.version).not.toBe(before?.version);
    });
});
