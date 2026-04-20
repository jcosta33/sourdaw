import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { type SoundPreset } from '../../../models/SoundPreset';

export const userPresetStorage = createLocalStorage<SoundPreset[]>('sourdaw-user-presets');

export function readStoredPresets(): SoundPreset[] {
    return userPresetStorage.get() ?? [];
}

export function writeStoredPresets(presets: SoundPreset[]): void {
    userPresetStorage.set(presets);
}
