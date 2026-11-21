import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { voicesPerNoteArticulation } from '../PerNoteArticulationByDeviceType';

describe('voicesPerNoteArticulation', () => {
    it('is true for Levain alone among the built-in vocabulary', () => {
        expect(BUILTIN_DEVICE_TYPES.filter((type) => voicesPerNoteArticulation(type))).toEqual(['levain']);
    });

    it.each(['faust-organ', 'external-plugin', '', 'Levain', 'LEVAIN', 'constructor', '__proto__', 'toString'])(
        'is false for %j',
        (type) => {
            expect(voicesPerNoteArticulation(type)).toBe(false);
        }
    );
});
