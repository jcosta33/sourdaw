import { GLUTEN_PRESETS } from './glutenPresets';

export function getGlutenFactoryPreset(presetId: string) {
    return GLUTEN_PRESETS.find((preset) => preset.id === presetId);
}
