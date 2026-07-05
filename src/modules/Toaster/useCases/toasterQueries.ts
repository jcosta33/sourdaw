import { TOASTER_PRESETS } from '../repositories/toasterPresets';

type GetToasterPresetsOutput = Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    kit: (typeof TOASTER_PRESETS)[number]['kit'];
}>;

export function getToasterPresets(): GetToasterPresetsOutput {
    return TOASTER_PRESETS.map((preset) => ({
        ...preset,
        tags: [...preset.tags],
        kit: structuredClone(preset.kit),
    }));
}
