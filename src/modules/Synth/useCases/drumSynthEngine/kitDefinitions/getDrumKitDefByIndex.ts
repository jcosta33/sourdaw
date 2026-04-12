import { type DrumKitDef } from '../../../models/DrumSynthTypes';

export const KIT_808_DEF: DrumKitDef = {
    id: 'kit-808',
    name: '808 Drum Machine',
    voices: [
        { name: 'Kick', midiNote: 36, type: 'kick' },
        { name: 'Rimshot', midiNote: 37, type: 'rimshot' },
        { name: 'Snare', midiNote: 38, type: 'snare' },
        { name: 'Clap', midiNote: 39, type: 'clap' },
        { name: 'Closed HH', midiNote: 42, type: 'closed-hh' },
        { name: 'Open HH', midiNote: 46, type: 'open-hh' },
        { name: 'Tom Low', midiNote: 43, type: 'tom-low' },
        { name: 'Tom Mid', midiNote: 47, type: 'tom-mid' },
        { name: 'Tom High', midiNote: 50, type: 'tom-high' },
        { name: 'Cowbell', midiNote: 56, type: 'cowbell' },
        { name: 'Conga Low', midiNote: 64, type: 'conga-low' },
        { name: 'Conga Mid', midiNote: 63, type: 'conga-mid' },
        { name: 'Conga High', midiNote: 62, type: 'conga-high' },
        { name: 'Maracas', midiNote: 70, type: 'maracas' },
        { name: 'Clave', midiNote: 75, type: 'clave' },
    ],
};

export const DRUM_KIT_DEFS: readonly DrumKitDef[] = [KIT_808_DEF];

export function getDrumKitDefByIndex(index: number): DrumKitDef | null {
    return DRUM_KIT_DEFS[index] ?? null;
}