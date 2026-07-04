import { type ProofChamberEngineState } from '../../models/ProofChamberState';

import { getUserPresets } from './helpers';
import { writeUserPresets } from './writeUserPresets';

export function saveUserPreset(name: string, params: ProofChamberEngineState): void {
    const presets = getUserPresets();
    presets.push({
        id: `user-${Date.now()}`,
        name,
        category: 'user',
        params: { ...params },
    });
    writeUserPresets(presets);
}
