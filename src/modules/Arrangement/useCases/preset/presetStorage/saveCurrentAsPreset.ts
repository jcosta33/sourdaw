import { findWithheldDeviceType } from '#/infra/release/deviceReleaseAdmission';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type SoundPreset } from '../../../models/SoundPreset';

import { saveUserPreset } from './saveUserPreset';

type SaveCurrentAsPresetCategory =
    'synth' | 'bass' | 'pad' | 'lead' | 'keys' | 'drums' | 'fx' | 'vocal' | 'guitar' | 'strings';

type SaveCurrentAsPresetDevice = {
    type: string;
    name: string;
    parameterValues: { [parameter_id: string]: number };
};

type SaveCurrentAsPresetInput = {
    name: string;
    category: SaveCurrentAsPresetCategory;
    description?: string;
    tags?: string[];
    trackKind: 'midi' | 'audio';
    devices: SaveCurrentAsPresetDevice[];
};
type SaveCurrentAsPresetOutput = SoundPreset | null;

export function saveCurrentAsPreset(input: SaveCurrentAsPresetInput): SaveCurrentAsPresetOutput {
    const withheldDeviceType = findWithheldDeviceType(input.devices);
    if (withheldDeviceType) {
        notifyUser(`Preset contains withheld device "${withheldDeviceType}" and was not saved.`, 'warning');
        return null;
    }
    return saveUserPreset({
        name: input.name,
        category: input.category,
        description: input.description ?? '',
        tags: input.tags ?? [],
        trackKind: input.trackKind,
        devices: input.devices,
    });
}
