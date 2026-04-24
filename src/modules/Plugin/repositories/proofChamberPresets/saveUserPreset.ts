import { type ProofChamberEngineState } from '../../models/ProofChamberState';

import { USER_PRESETS_KEY, getUserPresets } from './helpers';

export function saveUserPreset(name: string, params: ProofChamberEngineState): void {
    const presets = getUserPresets();
    presets.push({
        id: `user-${Date.now()}`,
        name,
        category: 'user',
        params: { ...params },
    });
    window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}
