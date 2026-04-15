import { type ProofChamberEngineState } from '../../models/ProofChamberState';

export function exportPresetJson(params: ProofChamberEngineState): string {
    return JSON.stringify(params, null, 2);
}