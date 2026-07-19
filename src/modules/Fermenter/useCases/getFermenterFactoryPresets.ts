import { FERMENTER_PRESETS } from '../repositories/fermenterPresets';

type FermenterFactoryDeviceParameterValues = {
    [parameter_id: string]: number;
};

type FermenterFactoryDevicePreset = {
    type: string;
    name: string;
    parameterValues: FermenterFactoryDeviceParameterValues;
};

type FermenterFactoryPresetCategory =
    'synth' | 'bass' | 'pad' | 'lead' | 'keys' | 'drums' | 'fx' | 'vocal' | 'guitar' | 'strings';

type FermenterFactoryPreset = {
    id: string;
    name: string;
    category: FermenterFactoryPresetCategory;
    subcategory?: string;
    description: string;
    trackKind: 'midi' | 'audio';
    devices: FermenterFactoryDevicePreset[];
    tags: string[];
    author: string;
    isFactory: boolean;
};

type GetFermenterFactoryPresetsOutput = FermenterFactoryPreset[];

export function getFermenterFactoryPresets(): GetFermenterFactoryPresetsOutput {
    return FERMENTER_PRESETS.map((preset) => ({
        ...preset,
        devices: preset.devices.map((device) => ({
            ...device,
            parameterValues: { ...device.parameterValues },
        })),
        tags: [...preset.tags],
    }));
}
