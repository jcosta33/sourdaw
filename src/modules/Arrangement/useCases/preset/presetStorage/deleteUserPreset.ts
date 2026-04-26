import { readStoredPresets, writeStoredPresets } from './helpers';

export function deleteUserPreset(presetId: string): void {
    const stored = readStoredPresets();
    writeStoredPresets(stored.filter((param) => param.id !== presetId));
}
