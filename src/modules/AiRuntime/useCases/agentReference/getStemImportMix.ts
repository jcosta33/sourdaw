import { type StemImportRole } from '#/utils/handlerContract';

const MIX_BY_ROLE: Record<StemImportRole, { gain: number; pan: number }> = {
    kick: { gain: 0.8, pan: 0 },
    snare: { gain: 0.7, pan: 0 },
    'hi-hat': { gain: 0.58, pan: 15 },
    tom: { gain: 0.62, pan: 0 },
    percussion: { gain: 0.55, pan: 0 },
    bass: { gain: 0.72, pan: 0 },
    'guitar-left': { gain: 0.62, pan: -20 },
    'guitar-right': { gain: 0.62, pan: 20 },
    keys: { gain: 0.58, pan: 0 },
    synth: { gain: 0.58, pan: 0 },
    'lead-vocal': { gain: 0.7, pan: 0 },
    'backing-vocal': { gain: 0.56, pan: 0 },
    fx: { gain: 0.5, pan: 0 },
    other: { gain: 0.6, pan: 0 },
};

export function getStemImportMix(role: StemImportRole): { gain: number; pan: number } {
    return MIX_BY_ROLE[role];
}
