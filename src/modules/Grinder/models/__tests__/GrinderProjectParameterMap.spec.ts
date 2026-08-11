import { describe, expect, it } from 'vitest';

import { getAutomationDeviceDescriptor } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../GrinderPatch';
import { applyGrinderProjectParameters, GRINDER_PROJECT_PARAM_KEYS } from '../GrinderProjectParameterMap';

describe('Grinder project parameter projection', () => {
    it('contains every descriptor-backed control in the serialized patch contract', () => {
        const descriptorKeys = getAutomationDeviceDescriptor('grinder')?.parameters.map((parameter) => parameter.id);
        const serializedKeys = new Set<string>(GRINDER_PROJECT_PARAM_KEYS);

        expect(descriptorKeys?.every((key) => serializedKeys.has(key))).toBe(true);
        expect(new Set(GRINDER_PROJECT_PARAM_KEYS).size).toBe(GRINDER_PROJECT_PARAM_KEYS.length);
    });

    it('decodes stored values, restores absent defaults, and preserves session-only fields', () => {
        const projected = applyGrinderProjectParameters(
            {
                ...DEFAULT_PATCH,
                uiSection: 'lab',
                gain: 9,
                bright: true,
                cabType: 'ir',
            },
            {
                gain: 2,
                bright: 0,
                cabType: 1.5,
                routingMode: 1.5,
                neuralCpuBudget: 1.5,
            }
        );

        expect(projected).toMatchObject({
            uiSection: 'lab',
            gain: 2,
            bright: false,
            cabType: 'both',
            routingMode: 'wet-dry-wet',
            neuralCpuBudget: 2,
        });

        expect(applyGrinderProjectParameters(projected, {}).cabType).toBe(DEFAULT_PATCH.cabType);
    });
});
