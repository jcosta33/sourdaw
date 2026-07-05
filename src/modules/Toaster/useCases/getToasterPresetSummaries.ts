import { TOASTER_PRESETS } from '../repositories/toasterPresets';

type GetToasterPresetSummariesOutput = Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
}>;

export function getToasterPresetSummaries(): GetToasterPresetSummariesOutput {
    return TOASTER_PRESETS.map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        tags: [...preset.tags],
    }));
}
