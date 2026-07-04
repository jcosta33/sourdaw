import { type SoundPreset } from '../../../models/SoundPreset';

import { userPresetStorage } from './helpers';

type WriteStoredPresetsInput = SoundPreset[];

export function writeStoredPresets(presets: WriteStoredPresetsInput): void {
    userPresetStorage.set(presets);
}
