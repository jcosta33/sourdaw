import { getUserPresets } from './helpers';
import { writeUserPresets } from './writeUserPresets';

export function deleteUserPreset(id: string): void {
    const presets = getUserPresets().filter((param) => param.id !== id);
    writeUserPresets(presets);
}
