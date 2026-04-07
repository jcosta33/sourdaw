/**
 * Public read use case exposing the built-in Grand Boule preset list.
 *
 * Returns a dedicated summary shape so the module's `GrandBoulePreset`
 * model does not leak across bounded-context boundaries. Consumers that
 * only need to display a list of presets get exactly those fields.
 */

import { listBuiltinGrandBoulePresets } from '../repositories/grandBoulePresetCatalog';

export type ListGrandBoulePresetsOutput = ReadonlyArray<{
    id: string;
    name: string;
    description: string;
}>;

export const listGrandBoulePresets = (): ListGrandBoulePresetsOutput =>
    listBuiltinGrandBoulePresets().map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
    }));
