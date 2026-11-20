import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import {
    classifyNoteReceivingDevice,
    isBuiltinSynthDevice,
    isDrumDevice,
    type NoteReceivingInstrumentKind,
} from '../NoteInputKindByDeviceType';

// A registry-shaped Faust predicate: registered Faust modules carry `faust-` ids,
// and only the one registered as an instrument answers true.
const isRegisteredFaustInstrument = (deviceType: string) => deviceType === 'faust-x';
const noFaustInstrument = () => false;

// The answer every route has given each input. Built by hand, never derived
// from the subject, so a moved or reordered arm shows up as a failed row.
const EXPECTED_KIND: ReadonlyArray<readonly [string, NoteReceivingInstrumentKind | null]> = [
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
    ['builtin-synth', 'builtin-synth'],
    ['builtin-synth-mellotron', 'builtin-synth'],
    ['builtin-synth-strings', 'builtin-synth'],
    ['builtin-synth-808bass', 'builtin-synth'],
    ['builtin-synth-brass', 'builtin-synth'],
    ['builtin-drum-kit', 'drum'],
    ['builtin-drum-machine-808', 'drum'],
    ['builtin-drum-machine-analog', 'drum'],
    ['builtin-drum-machine-electronic', 'drum'],
    ['builtin-drum-machine-acoustic', 'drum'],
    ['fermenter', 'worklet-synth'],
    ['toaster', 'toaster'],
    ['levain', 'worklet-synth'],
    ['builtin-crumbs', 'worklet-synth'],
    ['grand-boule', 'worklet-synth'],
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
    ['drum-kit', 'drum'],
    ['synth', 'builtin-synth'],
    // Strings a project file can carry that are not vocabulary ids.
    ['builtin-drum-machine-unknown', 'drum'],
    ['builtin-synth-unknown', 'builtin-synth'],
    ['constructor', null],
    ['__proto__', null],
    ['toString', null],
    ['hasOwnProperty', null],
    ['', null],
    ['Knead', null],
    ['external-plugin', null],
    ['faust-x', 'faust'],
];

describe('classifyNoteReceivingDevice', () => {
    it('has a hand-written row for every built-in vocabulary id', () => {
        const covered = new Set(EXPECTED_KIND.map(([deviceType]) => deviceType));

        expect(BUILTIN_DEVICE_TYPES.filter((deviceType) => !covered.has(deviceType))).toEqual([]);
    });

    it.each(EXPECTED_KIND)('classifies %j as %j', (deviceType, kind) => {
        expect(classifyNoteReceivingDevice(deviceType, isRegisteredFaustInstrument)).toBe(kind);
    });

    it('takes a Faust module as an instrument only when the registry says it is one', () => {
        expect(classifyNoteReceivingDevice('faust-x', isRegisteredFaustInstrument)).toBe('faust');
        expect(classifyNoteReceivingDevice('faust-x', noFaustInstrument)).toBeNull();
    });
});

describe('isDrumDevice and isBuiltinSynthDevice', () => {
    it.each(EXPECTED_KIND)('answer %j from its kind %j', (deviceType, kind) => {
        expect(isDrumDevice(deviceType)).toBe(kind === 'drum');
        expect(isBuiltinSynthDevice(deviceType)).toBe(kind === 'builtin-synth');
    });
});

describe('isDrumDevice', () => {
    it('returns true for builtin-drum-kit', () => {
        expect(isDrumDevice('builtin-drum-kit')).toBe(true);
    });

    it('returns true for bare drum-kit (legacy id)', () => {
        expect(isDrumDevice('drum-kit')).toBe(true);
    });

    it('returns true for builtin-drum-machine prefix', () => {
        expect(isDrumDevice('builtin-drum-machine-909')).toBe(true);
        expect(isDrumDevice('builtin-drum-machine-cr78')).toBe(true);
    });

    it('returns false for synth types', () => {
        expect(isDrumDevice('synth')).toBe(false);
        expect(isDrumDevice('builtin-synth-strings')).toBe(false);
    });

    it('returns false for effect types', () => {
        expect(isDrumDevice('fermenter')).toBe(false);
        expect(isDrumDevice('gluten')).toBe(false);
        expect(isDrumDevice('crust')).toBe(false);
    });

    it('returns false for arbitrary strings', () => {
        expect(isDrumDevice('')).toBe(false);
        expect(isDrumDevice('unknown')).toBe(false);
    });
});

describe('isBuiltinSynthDevice', () => {
    it('returns true for bare synth', () => {
        expect(isBuiltinSynthDevice('synth')).toBe(true);
    });

    it('returns true for builtin-synth prefix', () => {
        expect(isBuiltinSynthDevice('builtin-synth-strings')).toBe(true);
        expect(isBuiltinSynthDevice('builtin-synth-poly')).toBe(true);
    });

    it('returns false for drum types', () => {
        expect(isBuiltinSynthDevice('drum-kit')).toBe(false);
        expect(isBuiltinSynthDevice('builtin-drum-kit')).toBe(false);
        expect(isBuiltinSynthDevice('builtin-drum-machine-909')).toBe(false);
    });

    it('returns false for effect types', () => {
        expect(isBuiltinSynthDevice('crust')).toBe(false);
        expect(isBuiltinSynthDevice('fermenter')).toBe(false);
    });

    it('returns false for arbitrary strings', () => {
        expect(isBuiltinSynthDevice('')).toBe(false);
        expect(isBuiltinSynthDevice('unknown')).toBe(false);
    });
});

describe('isDrumDevice and isBuiltinSynthDevice are mutually exclusive', () => {
    it('no device type is both drum and synth', () => {
        const types = [
            'synth',
            'builtin-synth-strings',
            'builtin-synth-poly',
            'drum-kit',
            'builtin-drum-kit',
            'builtin-drum-machine-909',
            'fermenter',
            'gluten',
            'crust',
            'levain',
        ];
        for (const type of types) {
            expect(isDrumDevice(type) && isBuiltinSynthDevice(type)).toBe(false);
        }
    });
});
