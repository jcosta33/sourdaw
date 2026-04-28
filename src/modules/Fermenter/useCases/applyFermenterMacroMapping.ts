import { type FermenterPatch } from '../models/FermenterPatch';

type ApplyFermenterMacroMappingInput = {
    patch: FermenterPatch;
    index: number;
    value: number;
};

type ApplyFermenterMacroMappingOutput = FermenterPatch;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const scale = ({ value, min, max }: { value: number; min: number; max: number }): number => min + value * (max - min);

export function applyFermenterMacroMapping(input: ApplyFermenterMacroMappingInput): ApplyFermenterMacroMappingOutput {
    const value = clamp01(input.value);
    const macros: FermenterPatch['macros'] = [...input.patch.macros];

    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= macros.length) {
        return { ...input.patch, macros };
    }

    macros[input.index] = value;
    const next_patch: FermenterPatch = { ...input.patch, macros };

    if (input.index === 0) {
        next_patch.filterCutoff = scale({ value, min: 180, max: 12_000 });
        return next_patch;
    }
    if (input.index === 1) {
        next_patch.lfoFilterAmount = scale({ value, min: -1, max: 1 });
        return next_patch;
    }
    if (input.index === 2) {
        next_patch.stereoWidth = scale({ value, min: 0.45, max: 1.85 });
        return next_patch;
    }
    if (input.index === 3) {
        next_patch.distDrive = scale({ value, min: 0, max: 8 });
        next_patch.distMix = scale({ value, min: 0, max: 0.55 });
        return next_patch;
    }
    if (input.index === 4) {
        next_patch.reverbMix = scale({ value, min: 0, max: 0.7 });
        return next_patch;
    }
    if (input.index === 5) {
        next_patch.compMix = scale({ value, min: 0, max: 0.65 });
        next_patch.compThreshold = scale({ value, min: -8, max: -32 });
        return next_patch;
    }
    if (input.index === 6) {
        next_patch.warpAmount = value;
        return next_patch;
    }
    if (input.index === 7) {
        next_patch.chaosAmount = value;
        return next_patch;
    }

    return next_patch;
}
