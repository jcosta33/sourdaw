import {
    DEFAULT_MACRO_MAPPINGS,
    type FermenterMacroMapping,
    type FermenterMacroTarget,
    type FermenterPatch,
} from '../models/FermenterPatch';

type ApplyFermenterMacroMappingInput = {
    patch: FermenterPatch;
    index: number;
    value: number;
};

type ApplyFermenterMacroMappingOutput = FermenterPatch;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function clamp({ value, min, max }: { value: number; min: number; max: number }): number {
    return Math.min(max, Math.max(min, value));
}

function shapedBipolarValue({ value, target }: { value: number; target: FermenterMacroTarget }): number {
    const bipolar = value * 2 - 1;
    let shaped = bipolar;
    if (target.curve === 'exponential') {
        shaped = Math.sign(bipolar) * Math.abs(bipolar) * Math.abs(bipolar);
    }

    return clamp({ value: target.center + shaped * target.depth, min: target.min, max: target.max });
}

function getMacroMapping({ patch, index }: { patch: FermenterPatch; index: number }): FermenterMacroMapping {
    return patch.macroMappings?.[index] ?? DEFAULT_MACRO_MAPPINGS[index] ?? { targets: [] };
}

function applyMacroTarget({
    patch,
    value,
    target,
}: {
    patch: FermenterPatch;
    value: number;
    target: FermenterMacroTarget;
}): void {
    if (typeof patch[target.target] !== 'number') {
        return;
    }

    (patch as Record<keyof FermenterPatch, unknown>)[target.target] = shapedBipolarValue({ value, target });
}

export function applyFermenterMacroMapping(input: ApplyFermenterMacroMappingInput): ApplyFermenterMacroMappingOutput {
    const value = clamp01(input.value);
    const macros: FermenterPatch['macros'] = [...input.patch.macros];

    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= macros.length) {
        return { ...input.patch, macros };
    }

    macros[input.index] = value;
    const next_patch: FermenterPatch = {
        ...input.patch,
        macros,
        macroMappings: [...(input.patch.macroMappings ?? DEFAULT_MACRO_MAPPINGS)],
    };
    const mapping = getMacroMapping({ patch: next_patch, index: input.index });

    for (const target of mapping.targets) {
        applyMacroTarget({ patch: next_patch, value, target });
    }

    return next_patch;
}
