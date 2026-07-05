import { TOASTER_PRESETS } from '../repositories/toasterPresets';

type GetToasterPresetKitOutput = (typeof TOASTER_PRESETS)[number]['kit'] | null;

export function getToasterPresetKit(presetId: string): GetToasterPresetKitOutput {
    const preset = TOASTER_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
        return null;
    }

    return structuredClone(preset.kit);
}
