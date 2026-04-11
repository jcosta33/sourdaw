import { type ProofChamberParams, DEFAULT_PARAMS } from '../../models/ProofChamberPatch';

export function importPresetJson(json: string): ProofChamberParams | null {
    try {
        const parsed = JSON.parse(json) as ProofChamberParams;
        if (typeof parsed.mix === 'number' && typeof parsed.decay === 'number') {
            return { ...DEFAULT_PARAMS, ...parsed };
        }
    } catch {
        /* ignore */
    }
    return null;
}