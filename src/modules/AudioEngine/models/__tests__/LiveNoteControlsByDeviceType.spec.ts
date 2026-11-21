import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { resolveLiveNoteControls } from '../LiveNoteControlsByDeviceType';

type ExpectedRow = Readonly<{
    controlsKey: string;
    velocityOf127: number;
    velocityOf64: number;
    expressionDimensions: readonly string[];
}>;

// The controls, scaled velocities and sounded expression every route has used
// for each id. Built by hand, never derived from the subject, so a moved or
// retyped row shows up as a failed case.
const EXPECTED_WORKLET_ROWS: ReadonlyArray<readonly [string, ExpectedRow]> = [
    [
        'fermenter',
        {
            controlsKey: 'fermenterControls',
            velocityOf127: 127,
            velocityOf64: 64,
            expressionDimensions: ['pitchBend', 'pressure', 'slide'],
        },
    ],
    [
        'levain',
        {
            controlsKey: 'levainControls',
            velocityOf127: 127,
            velocityOf64: 64,
            expressionDimensions: ['pitchBend', 'pressure', 'slide'],
        },
    ],
    [
        'grand-boule',
        {
            controlsKey: 'grandBouleControls',
            velocityOf127: 1,
            velocityOf64: 64 / 127,
            expressionDimensions: ['pitchBend'],
        },
    ],
    [
        'builtin-crumbs',
        { controlsKey: 'crumbsControls', velocityOf127: 127, velocityOf64: 64, expressionDimensions: [] },
    ],
];

const EXPECTED_NULL_ROWS: ReadonlyArray<readonly [string, null]> = [
    ['builtin-eq', null],
    ['builtin-compressor', null],
    ['builtin-reverb', null],
    ['builtin-delay', null],
    ['builtin-gain', null],
    ['builtin-sidechain-compressor', null],
    ['builtin-chorus', null],
    ['builtin-phaser', null],
    ['builtin-distortion', null],
    ['builtin-limiter', null],
    ['builtin-flanger', null],
    ['builtin-tremolo', null],
    ['builtin-bitcrusher', null],
    ['builtin-filter', null],
    ['builtin-autopan', null],
    ['builtin-convolution-reverb', null],
    ['builtin-stereo-widener', null],
    ['builtin-deesser', null],
    ['builtin-lufs-meter', null],
    ['builtin-synth', null],
    ['builtin-synth-mellotron', null],
    ['builtin-synth-strings', null],
    ['builtin-synth-808bass', null],
    ['builtin-synth-brass', null],
    ['builtin-drum-kit', null],
    ['builtin-drum-machine-808', null],
    ['builtin-drum-machine-analog', null],
    ['builtin-drum-machine-electronic', null],
    ['builtin-drum-machine-acoustic', null],
    ['toaster', null],
    ['gluten', null],
    ['crust', null],
    ['bacteria', null],
    ['grinder', null],
    ['proof', null],
    ['dutch-oven', null],
    ['native-scoring', null],
    ['knead', null],
    ['transient-shaper', null],
    ['yeast', null],
    ['drum-kit', null],
    ['synth', null],
];

describe('resolveLiveNoteControls', () => {
    it.each(EXPECTED_WORKLET_ROWS)('answers the live note controls of %s', (deviceType, expected) => {
        const controls = resolveLiveNoteControls(deviceType);
        expect(controls?.controlsKey).toBe(expected.controlsKey);
        expect(controls?.scaleVelocity(127)).toBe(expected.velocityOf127);
        expect(controls?.scaleVelocity(64)).toBe(expected.velocityOf64);
        expect(controls?.expressionDimensions).toEqual(expected.expressionDimensions);
    });

    it.each(EXPECTED_NULL_ROWS)('answers no live note controls for %s', (deviceType, expected) => {
        expect(resolveLiveNoteControls(deviceType)).toBe(expected);
    });

    it.each(['builtin-synth-unknown', 'Knead', 'constructor', '__proto__', '', 'faust-x', 'external-plugin'])(
        'answers no live note controls for the non-vocabulary string %j',
        (deviceType) => {
            expect(resolveLiveNoteControls(deviceType)).toBeNull();
        }
    );

    it('covers every built-in device type with a hand-written row', () => {
        const covered = new Set<string>([
            ...EXPECTED_WORKLET_ROWS.map(([deviceType]) => deviceType),
            ...EXPECTED_NULL_ROWS.map(([deviceType]) => deviceType),
        ]);
        expect(BUILTIN_DEVICE_TYPES.filter((deviceType) => !covered.has(deviceType))).toEqual([]);
        expect(covered.size).toBe(BUILTIN_DEVICE_TYPES.length);
    });
});
