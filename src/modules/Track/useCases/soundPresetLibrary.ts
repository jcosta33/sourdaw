import { type SoundPreset, type SoundPresetCategory } from '#/modules/Track/models/SoundPreset';
import { FACTORY_PRESETS, DRUM_KIT_PRESETS, FAUST_SYNTH_PRESETS } from '#/modules/Track/helpers/factoryPresets';

let cachedPresets: SoundPreset[] | null = null;

export type GetFactoryPresetsOutput = SoundPreset[];

export function getFactoryPresets(): GetFactoryPresetsOutput {
    if (!cachedPresets) {
        cachedPresets = [...FACTORY_PRESETS, ...DRUM_KIT_PRESETS, ...FAUST_SYNTH_PRESETS];
    }
    return cachedPresets;
}

export type GetPresetsByCategoryInput = SoundPresetCategory;
export type GetPresetsByCategoryOutput = SoundPreset[];

export function getPresetsByCategory(category: GetPresetsByCategoryInput): GetPresetsByCategoryOutput {
    return getFactoryPresets().filter((p) => p.category === category);
}
