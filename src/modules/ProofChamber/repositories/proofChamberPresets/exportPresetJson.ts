import { type ProofChamberParams } from '../../models/ProofChamberPatch';

export function exportPresetJson(params: ProofChamberParams): string {
    return JSON.stringify(params, null, 2);
}