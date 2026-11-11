import { DEFAULT_PATCH, type FermenterPatch } from '../models/FermenterPatch';
import { cloneFermenterPatch } from '../models/FermenterPatchState';

import { FERMENTER_PRESETS } from './fermenterQueries/helpers';

export function resolveFermenterPresetPatch(
    presetId: string,
    userPatches: Array<{ id: string; name: string; patch: FermenterPatch }>
): FermenterPatch | null {
    const userPatch = userPatches.find((patch) => patch.id === presetId);
    if (userPatch) {
        return cloneFermenterPatch(userPatch.patch);
    }

    const preset = FERMENTER_PRESETS.find((entry) => entry.id === presetId);
    const values = preset?.devices[0]?.parameterValues;
    if (!preset || !values) {
        return null;
    }

    const patch = cloneFermenterPatch({ ...DEFAULT_PATCH, name: preset.name });
    for (const [key, value] of Object.entries(values)) {
        if (key in patch && typeof value === 'number') {
            (patch as Record<string, unknown>)[key] = value;
        } else if (key.startsWith('macro') && typeof value === 'number') {
            const index = Number.parseInt(key.slice(5), 10);
            if (index >= 0 && index < 8) {
                patch.macros[index] = value;
            }
        }
    }
    return patch;
}

export function randomizeFermenterPatch(): FermenterPatch {
    const range = (min: number, max: number) => min + Math.random() * (max - min);
    const randomInt = (min: number, max: number) => Math.floor(range(min, max + 1));

    return cloneFermenterPatch({
        ...DEFAULT_PATCH,
        name: 'Random',
        oscEngine: randomInt(0, 6),
        oscWaveform: randomInt(0, 3),
        oscLevel: range(0.5, 1),
        filterModel: randomInt(0, 5),
        filterCutoff: range(200, 12000),
        filterResonance: range(0.5, 8),
        ampAttack: range(0.001, 0.5),
        ampDecay: range(0.05, 1),
        ampSustain: range(0, 1),
        ampRelease: range(0.05, 2),
        filterEnvAmount: range(-0.8, 0.8),
        reverbMix: range(0, 0.6),
        masterGain: range(0.6, 1),
        macros: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    });
}
