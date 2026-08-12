import { describe, expect, it } from 'vitest';

import { FERMENTER_PARAMS } from '#/modules/Fermenter/useCases';

import { FERMENTER_DESCRIPTOR } from '../FermenterDescriptor';

describe('Fermenter parameter metadata weld', () => {
    it('keeps the Fermenter table aligned with the descriptor write contract', () => {
        const moduleParams = new Map(FERMENTER_PARAMS.map((param) => [param.id, param]));
        const descriptorParams = new Map(FERMENTER_DESCRIPTOR.parameters.map((param) => [param.id, param]));

        expect([...moduleParams.keys()]).toEqual([...descriptorParams.keys()]);
        expect(
            [...moduleParams.values()].map((param) => ({
                id: param.id,
                min: param.min,
                max: param.max,
                defaultValue: param.default,
                unit: param.unit,
                type: param.step === 1 ? 'int' : 'float',
            }))
        ).toEqual(
            [...descriptorParams.values()].map((param) => ({
                id: param.id,
                min: param.minValue,
                max: param.maxValue,
                defaultValue: param.defaultValue,
                unit: param.unit,
                type: param.type,
            }))
        );
    });
});
