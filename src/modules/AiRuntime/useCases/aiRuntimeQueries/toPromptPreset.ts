import { type PresetAction } from '../../models/PresetActions/Registry';
import { type PromptPreset } from '../../models/PromptPreset';

export function toPromptPreset(preset: PresetAction): PromptPreset {
    return {
        id: preset.id,
        label: preset.label,
        category: preset.category,
        isDestructive: preset.isDestructive ?? false,
    };
}
