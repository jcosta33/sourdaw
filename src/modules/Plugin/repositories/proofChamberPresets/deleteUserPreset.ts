import { USER_PRESETS_KEY, getUserPresets } from './helpers';

export function deleteUserPreset(id: string): void {
    const presets = getUserPresets().filter((p) => p.id !== id);
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}
