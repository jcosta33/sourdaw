import { type ProofChamberPreset, USER_PRESETS_KEY } from './helpers';

type WriteUserPresetsInput = ProofChamberPreset[];

export function writeUserPresets(presets: WriteUserPresetsInput): void {
    globalThis.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}
