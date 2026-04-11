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
