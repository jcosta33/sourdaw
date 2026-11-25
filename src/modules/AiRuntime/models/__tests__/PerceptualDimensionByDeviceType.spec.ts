import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { type PerceptualExcludedDimension } from '../PerceptualConstraint';
import {
    readDimensionEditedByEveryWrite,
    readPerceptualDimensionOfDeviceType,
} from '../PerceptualDimensionByDeviceType';

type Row = readonly [string, PerceptualExcludedDimension | null, PerceptualExcludedDimension | null];

// [type, dimension of the whole device, dimension every parameter write edits]. Written by hand
// from the sets the transformer held before the table existed, never derived from the subject.
const NON_ROWS: readonly string[] = BUILTIN_DEVICE_TYPES.filter(
    (type) =>
        ![
            'builtin-eq',
            'builtin-filter',
            'builtin-reverb',
            'builtin-convolution-reverb',
            'builtin-delay',
            'builtin-chorus',
            'builtin-stereo-widener',
        ].includes(type)
);

const SHAPING_ROWS: readonly Row[] = [
    ['builtin-eq', 'low-frequency-band', null],
    ['builtin-filter', 'low-frequency-band', 'low-frequency-band'],
    ['builtin-reverb', 'ambience', 'ambience'],
    ['builtin-convolution-reverb', 'ambience', 'ambience'],
    ['builtin-delay', 'ambience', 'ambience'],
    ['builtin-chorus', 'ambience', 'ambience'],
    ['builtin-stereo-widener', 'ambience', 'ambience'],
];

const NO_DIMENSION_INPUTS = [
    ...NON_ROWS,
    'faust-reverb',
    'external-plugin',
    '',
    'Builtin-EQ',
    'BUILTIN-REVERB',
    'constructor',
    '__proto__',
    'toString',
];

describe('PerceptualDimensionByDeviceType', () => {
    it.each(SHAPING_ROWS)('answers %j with whole-device %j and every-write %j', (type, whole, everyWrite) => {
        expect(readPerceptualDimensionOfDeviceType(type)).toBe(whole);
        expect(readDimensionEditedByEveryWrite(type)).toBe(everyWrite);
    });

    it('covers every built-in type either as a shaping row or as no dimension', () => {
        expect(SHAPING_ROWS.length + NON_ROWS.length).toBe(BUILTIN_DEVICE_TYPES.length);
    });

    it.each(NO_DIMENSION_INPUTS)('answers null for %j', (type) => {
        expect(readPerceptualDimensionOfDeviceType(type)).toBeNull();
        expect(readDimensionEditedByEveryWrite(type)).toBeNull();
    });
});
