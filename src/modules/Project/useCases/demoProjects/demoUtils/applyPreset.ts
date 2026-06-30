import { getFactoryPresets } from '#/modules/Arrangement/useCases';

type ApplyPresetDeviceInput = {
    name: string;
    type: string;
    parameterValues: Record<string, number>;
};

type ApplyPresetDeviceOutput = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

type ApplyPresetTrackInput = {
    devices: ApplyPresetDeviceOutput[];
};

type ApplyPresetFactoryPresetInput = {
    id: string;
    devices?: ApplyPresetDeviceInput[];
};

export function applyPreset(track: ApplyPresetTrackInput, preset_id: string): void {
    const factory_presets: ApplyPresetFactoryPresetInput[] = getFactoryPresets();
    const preset = factory_presets.find((param) => param.id === preset_id);
    if (preset?.devices) {
        track.devices = preset.devices.map((data) => ({
            id: `dev-${crypto.randomUUID()}`,
            name: data.name,
            type: data.type,
            bypassed: false,
            parameterValues: { ...data.parameterValues },
        }));
    }
}
