import { type SoundPreset } from '../../../models/SoundPreset';

import { readStoredPresets } from './readStoredPresets';
import { writeStoredPresets } from './writeStoredPresets';

type SaveUserPresetCategory =
    | 'synth'
    | 'bass'
    | 'pad'
    | 'lead'
    | 'keys'
    | 'drums'
    | 'fx'
    | 'vocal'
    | 'guitar'
    | 'strings';

type SaveUserPresetDevice = {
    type: string;
    name: string;
    parameterValues: { [parameter_id: string]: number };
};

type SaveUserPresetInput = {
    name: string;
    category: SaveUserPresetCategory;
    subcategory?: string;
    description: string;
    trackKind: 'midi' | 'audio';
    devices: SaveUserPresetDevice[];
    tags: string[];
};
type SaveUserPresetOutput = SoundPreset;

export function saveUserPreset(preset: SaveUserPresetInput): SaveUserPresetOutput {
    const stored_presets = readStoredPresets();
    const full_preset: SoundPreset = {
        ...preset,
        id: `user-preset-${crypto.randomUUID()}`,
        author: 'User',
        isFactory: false,
    };
    writeStoredPresets([...stored_presets, full_preset]);
    return full_preset;
}
