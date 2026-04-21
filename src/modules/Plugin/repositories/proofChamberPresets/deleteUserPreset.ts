import { USER_PRESETS_KEY, getUserPresets } from './helpers';

export function deleteUserPreset(id: string): void {
    const presets = getUserPresets().filter((param) => param.id !== id);
    window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}
