import { type DevicePreset } from '#/modules/Arrangement/models/SoundPreset';
import { type Device } from '#/modules/Arrangement/models/Track';
import { getFactoryPresets } from '#/modules/Arrangement/useCases';

export function applyPreset(track: { devices: Device[] }, presetId: string): void {
    const preset = getFactoryPresets().find((param) => param.id === presetId);
    if (preset?.devices) {
        track.devices = preset.devices.map((data: DevicePreset) => ({
            id: `dev-${crypto.randomUUID()}`,
            name: data.name,
            type: data.type,
            bypassed: false,
            parameterValues: { ...data.parameterValues },
        }));
    }
}
