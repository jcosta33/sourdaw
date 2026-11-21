import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { resolveDeviceRoles } from '../DeviceRolesByDeviceType';

// [device type, midiTransform, offlineSource], written by hand from the
// behaviour each id had before the table existed, never derived from the subject.
const EXPECTED_ROWS: ReadonlyArray<readonly [string, boolean, boolean]> = [
    ['builtin-eq', false, false],
    ['builtin-compressor', false, false],
    ['builtin-reverb', false, false],
    ['builtin-delay', false, false],
    ['builtin-gain', false, false],
    ['builtin-sidechain-compressor', false, false],
    ['builtin-chorus', false, false],
    ['builtin-phaser', false, false],
    ['builtin-distortion', false, false],
    ['builtin-limiter', false, false],
    ['builtin-flanger', false, false],
    ['builtin-tremolo', false, false],
    ['builtin-bitcrusher', false, false],
    ['builtin-filter', false, false],
    ['builtin-autopan', false, false],
    ['builtin-convolution-reverb', false, false],
    ['builtin-stereo-widener', false, false],
    ['builtin-deesser', false, false],
    ['builtin-lufs-meter', false, false],
    ['builtin-synth', false, false],
    ['builtin-synth-mellotron', false, false],
    ['builtin-synth-strings', false, false],
    ['builtin-synth-808bass', false, false],
    ['builtin-synth-brass', false, false],
    ['builtin-drum-kit', false, true],
    ['builtin-drum-machine-808', false, true],
    ['builtin-drum-machine-analog', false, true],
    ['builtin-drum-machine-electronic', false, true],
    ['builtin-drum-machine-acoustic', false, true],
    ['fermenter', false, true],
    ['toaster', false, true],
    ['levain', false, true],
    ['builtin-crumbs', false, true],
    ['grand-boule', false, true],
    ['gluten', false, false],
    ['crust', false, false],
    ['bacteria', false, false],
    ['grinder', false, false],
    ['proof', false, false],
    ['dutch-oven', false, false],
    ['native-scoring', false, false],
    ['knead', false, false],
    ['transient-shaper', false, false],
    ['yeast', true, true],
    ['drum-kit', false, true],
    ['synth', false, false],
];

describe('resolveDeviceRoles', () => {
    it.each(EXPECTED_ROWS)('answers the roles of %s', (deviceType, midiTransform, offlineSource) => {
        expect(resolveDeviceRoles(deviceType)).toEqual({ midiTransform, offlineSource });
    });

    // The variant families the catalog generates fold to their base row.
    it.each([
        ['builtin-drum-machine-x', false, true],
        ['builtin-drum-machine', false, true],
        ['builtin-synth-x', false, false],
        ['Knead', false, false],
    ])('folds the unlisted string %j to its family row', (deviceType, midiTransform, offlineSource) => {
        expect(resolveDeviceRoles(deviceType)).toEqual({ midiTransform, offlineSource });
    });

    it.each(['Yeast', 'constructor', '__proto__', '', 'faust-x', 'external-plugin', 'crumbs'])(
        'answers no roles for the non-vocabulary string %j',
        (deviceType) => {
            expect(resolveDeviceRoles(deviceType)).toBeNull();
        }
    );

    it('covers every built-in device type with a hand-written row', () => {
        const covered = new Set(EXPECTED_ROWS.map(([deviceType]) => deviceType));
        expect(BUILTIN_DEVICE_TYPES.filter((deviceType) => !covered.has(deviceType))).toEqual([]);
        expect(covered.size).toBe(BUILTIN_DEVICE_TYPES.length);
    });
});
