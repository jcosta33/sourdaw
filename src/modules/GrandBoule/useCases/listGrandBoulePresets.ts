import { type GrandBoulePresetParameters } from '../models/GrandBoulePreset';
import { listBuiltinGrandBoulePresets } from '../repositories/grandBoulePresetCatalog';

export type ListGrandBoulePresetsOutput = ReadonlyArray<{
    id: string;
    name: string;
    description: string;
}>;

export function listGrandBoulePresets(): ListGrandBoulePresetsOutput {
    return listBuiltinGrandBoulePresets().map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
    }));
}

export function findMatchingGrandBoulePresetId(parameters: GrandBoulePresetParameters): string | null {
    const matches = listBuiltinGrandBoulePresets().filter(
        ({ parameters: preset }) =>
            preset.hammerHardness === parameters.hammerHardness &&
            preset.velocityCurve === parameters.velocityCurve &&
            preset.stereoWidth === parameters.stereoWidth &&
            preset.toneTilt === parameters.toneTilt
    );
    return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}
