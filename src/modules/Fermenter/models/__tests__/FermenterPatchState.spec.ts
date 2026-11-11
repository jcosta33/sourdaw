import { describe, expect, it } from 'vitest';

import { DEFAULT_PATCH } from '../FermenterPatch';
import {
    cloneFermenterPatch,
    fermenterPatchesEqual,
    fromFermenterDeviceState,
    toFermenterDeviceState,
} from '../FermenterPatchState';

describe('FermenterPatchState', () => {
    it('round-trips the complete patch without sharing nested macro state', () => {
        const original = cloneFermenterPatch({
            ...DEFAULT_PATCH,
            name: 'Nested patch',
            macros: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
        });
        original.macroMappings![0]!.targets[0]!.center = 777;

        const restored = fromFermenterDeviceState(toFermenterDeviceState(original));

        expect(restored).toEqual(original);
        expect(restored?.macros).not.toBe(original.macros);
        expect(restored?.macroMappings).not.toBe(original.macroMappings);
        expect(restored?.macroMappings?.[0]?.targets).not.toBe(original.macroMappings?.[0]?.targets);
    });

    it('compares nested macro mappings structurally rather than by reference', () => {
        const left = cloneFermenterPatch(DEFAULT_PATCH);
        const right = cloneFermenterPatch(DEFAULT_PATCH);
        expect(fermenterPatchesEqual(left, right)).toBe(true);

        right.macroMappings![3]!.targets[1]!.depth = 0.4;
        expect(fermenterPatchesEqual(left, right)).toBe(false);
    });

    it('never shares the default patch nested references', () => {
        const clone = cloneFermenterPatch(DEFAULT_PATCH);
        clone.macros[0] = 0.99;
        clone.macroMappings![0]!.targets[0]!.center = 123;

        expect(DEFAULT_PATCH.macros[0]).toBe(0.5);
        expect(DEFAULT_PATCH.macroMappings?.[0]?.targets[0]?.center).toBe(6090);
    });

    it('rejects foreign, partial, and non-finite snapshots', () => {
        expect(fromFermenterDeviceState({ version: 99, data: { patch: DEFAULT_PATCH } })).toBeNull();
        expect(fromFermenterDeviceState({ version: 1, data: { patch: { name: 'Partial' } } })).toBeNull();
        expect(
            fromFermenterDeviceState({
                version: 1,
                data: { patch: { ...DEFAULT_PATCH, filterCutoff: Number.NaN } },
            })
        ).toBeNull();
    });
});
