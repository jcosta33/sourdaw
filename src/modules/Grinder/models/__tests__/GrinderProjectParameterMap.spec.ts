import { describe, expect, it } from 'vitest';

import { getAutomationDeviceDescriptor } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../GrinderPatch';
import { applyGrinderProjectParameters, GRINDER_PROJECT_PARAM_KEYS } from '../GrinderProjectParameterMap';

describe('Grinder project parameter projection', () => {
    it('contains every descriptor-backed control in the serialized patch contract', () => {
        const descriptorKeys = getAutomationDeviceDescriptor('grinder')?.parameters.map((parameter) => parameter.id);
        expect(GRINDER_PROJECT_PARAM_KEYS).toEqual(expect.arrayContaining(descriptorKeys ?? []));
    });
    it('decodes flat and nested project values with the engine coercion laws', () => {
        const projected = applyGrinderProjectParameters(DEFAULT_PATCH, {
            cabType: 1.5,
            routingMode: 1.5,
            neuralCpuBudget: 1.5,
        });

        expect(projected).toMatchObject({
            cabType: 'both',
            routingMode: 'wet-dry-wet',
            neuralCpuBudget: 2,
        });
    });
});
