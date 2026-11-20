import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES, resolveBuiltinDeviceType } from '../builtinDeviceTypes';
import { NATIVE_DSP_DEVICE_TYPES, resolveNativeDspDeviceType } from '../nativeDspDeviceTypes';

describe('resolveBuiltinDeviceType', () => {
    it('resolves every vocabulary id to itself', () => {
        expect(BUILTIN_DEVICE_TYPES.map((deviceType) => resolveBuiltinDeviceType(deviceType))).toEqual([
            ...BUILTIN_DEVICE_TYPES,
        ]);
    });

    it.each([
        ['builtin-drum-machine-unknown', 'builtin-drum-kit'],
        ['builtin-drum-machine', 'builtin-drum-kit'],
        ['builtin-synth-unknown', 'builtin-synth'],
        ['builtin-synthx', 'builtin-synth'],
    ])('resolves the unlisted variant %j to its family base %j', (raw, base) => {
        expect(resolveBuiltinDeviceType(raw)).toBe(base);
    });

    it('case-folds knead, and only knead', () => {
        expect(resolveBuiltinDeviceType('Knead')).toBe('knead');
        expect(resolveBuiltinDeviceType('KNEAD')).toBe('knead');
        expect(resolveBuiltinDeviceType('Toaster')).toBeNull();
        expect(resolveBuiltinDeviceType('Builtin-Synth')).toBeNull();
    });

    // A project file or a model can carry any string; an inherited member of a
    // plain object must never pass for a device.
    it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', ''])(
        'does not resolve %j',
        (raw) => {
            expect(resolveBuiltinDeviceType(raw)).toBeNull();
        }
    );

    it.each(['faust-x', 'faust-rhodes', 'external-plugin', 'builtin-drum', 'drum-machine-808'])(
        'leaves %j outside the built-in vocabulary',
        (raw) => {
            expect(resolveBuiltinDeviceType(raw)).toBeNull();
        }
    );
});

describe('BUILTIN_DEVICE_TYPES', () => {
    it('holds no duplicates', () => {
        expect(new Set(BUILTIN_DEVICE_TYPES).size).toBe(BUILTIN_DEVICE_TYPES.length);
    });

    it('holds no Faust module and no hosted plugin', () => {
        expect(BUILTIN_DEVICE_TYPES.filter((deviceType) => deviceType.startsWith('faust-'))).toEqual([]);
        expect(BUILTIN_DEVICE_TYPES).not.toContain('external-plugin');
    });

    // The native resolver keeps its own, older arms; every native type it builds
    // must be a built-in id that the built-in resolver answers the same way.
    it('agrees with the native resolver on every native type', () => {
        for (const nativeType of NATIVE_DSP_DEVICE_TYPES) {
            expect(resolveBuiltinDeviceType(nativeType)).toBe(resolveNativeDspDeviceType(nativeType));
        }
    });
});
