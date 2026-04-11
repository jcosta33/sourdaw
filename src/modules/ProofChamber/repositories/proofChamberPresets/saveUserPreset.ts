import { type ProofChamberParams } from '../../models/ProofChamberPatch';
import { USER_PRESETS_KEY, getUserPresets } from './helpers';

export function saveUserPreset(name: string, params: ProofChamberParams): void {
    const presets = getUserPresets();
    presets.push({
        id: `user-${Date.now()}`,
        name,
        category: 'user',
        params: { ...params },
    });
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}