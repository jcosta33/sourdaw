import { type SoundPreset } from '../../../models/SoundPreset';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';
export const userPresetStorage = createLocalStorage<SoundPreset[]>('sourdaw-user-presets');

export function readStoredPresets(): SoundPreset[] {
    return userPresetStorage.get() ?? [];
}

export function writeStoredPresets(presets: SoundPreset[]): void {
    userPresetStorage.set(presets);
}