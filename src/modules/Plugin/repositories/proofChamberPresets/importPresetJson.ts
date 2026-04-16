import { type ProofChamberEngineState, DEFAULT_PARAMS } from '../../models/ProofChamberState';

export function importPresetJson(json: string): ProofChamberEngineState | null {
    try {
        const parsed = JSON.parse(json) as ProofChamberEngineState;
        if (typeof parsed.mix === 'number' && typeof parsed.decay === 'number') {
            return { ...DEFAULT_PARAMS, ...parsed };
        }
    } catch {
        /* ignore */
    }
    return null;
}