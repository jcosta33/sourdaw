import { describe, expect, it } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { projectOpenAiStrictToolSchema } from '../../repositories/cloudLlm/cloudInference/projectOpenAiStrictToolSchema';
import { PAYLOAD_VALIDATORS } from '../validateActionPayload';

describe('direct-level command schemas', () => {
    it.each([
        {
            name: 'setVcaGain',
            keys: ['vcaGroupId', 'gainDb', 'deltaDb', 'gain'],
            valid: { vcaGroupId: 'vca-1', gainDb: -6 },
            invalid: { vcaGroupId: 'vca-1', gain: 0.5, gainDb: -6 },
        },
        {
            name: 'setMetronomeVolume',
            keys: ['volumeDb', 'deltaDb', 'volume'],
            valid: { deltaDb: -2 },
            invalid: { volume: 0.5, deltaDb: -2 },
        },
    ] as const)(
        'publishes strict fields and admits exactly one level form for $name',
        ({ name, keys, valid, invalid }) => {
            const schema = getExecutableAppActionToolSchemas().find((candidate) => candidate.function.name === name);
            if (!schema) {
                throw new Error(`Missing ${name} schema`);
            }
            const strict = projectOpenAiStrictToolSchema(schema);
            expect(strict.function.parameters.required).toEqual(keys);
            expect(strict.function.parameters.additionalProperties).toBe(false);
            const validator = PAYLOAD_VALIDATORS[name];
            if (typeof validator !== 'function') {
                throw new TypeError(`Missing ${name} validator`);
            }
            expect(validator(valid)).toBe(true);
            expect(validator(invalid)).toBe(false);
            expect(validator({ ...valid, extra: true })).toBe(false);
        }
    );
});
