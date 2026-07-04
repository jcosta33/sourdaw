import { type DrumKitDef, type DrumVoiceDef } from '../../../models/DrumSynthTypes';

export function findVoiceByNote(kit: DrumKitDef, midiNote: number): DrumVoiceDef | null {
    return kit.voices.find((voice) => voice.midiNote === midiNote) ?? null;
}
