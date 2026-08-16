import { getStableContractFingerprint } from '../../models/GetStableContractFingerprint';
import { type SoundPreset } from '../../models/SoundPreset';

type FactoryPresetIdentity = {
    id: string;
    name: string;
};

type FactoryPresetDeviceContract = {
    type: string;
    availability: 'available' | 'none';
    identities: readonly FactoryPresetIdentity[];
    presetVersion: string;
};

export function getFactoryPresetContractsByDeviceType(
    factoryPresets: readonly SoundPreset[],
    deviceTypes: readonly string[]
): readonly FactoryPresetDeviceContract[] {
    return deviceTypes.map((type) => {
        const identities = factoryPresets
            .filter((preset) => preset.devices.some((device) => device.type === type))
            .map(({ id, name }) => ({ id, name }));
        const availability = identities.length > 0 ? 'available' : 'none';

        return {
            type,
            availability,
            identities,
            presetVersion: `preset-v1:${getStableContractFingerprint({ availability, identities })}`,
        };
    });
}
