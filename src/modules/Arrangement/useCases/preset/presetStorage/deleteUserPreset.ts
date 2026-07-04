import { readStoredPresets } from './readStoredPresets';
import { writeStoredPresets } from './writeStoredPresets';

export function deleteUserPreset(presetId: string): void {
    const stored = readStoredPresets();
    writeStoredPresets(stored.filter((param) => param.id !== presetId));
}
