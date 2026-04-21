import { getFactoryPresets } from '#/modules/Arrangement/useCases';

export function applyPreset(track: any, presetId: string) {
    const preset = getFactoryPresets().find((param) => param.id === presetId);
    if (preset && preset.devices) {
        track.devices = preset.devices.map((data: any) => ({
            id: `dev-${crypto.randomUUID()}`,
            name: data.name,
            type: data.type,
            bypassed: false,
            parameterValues: { ...data.parameterValues },
        }));
    }
}
