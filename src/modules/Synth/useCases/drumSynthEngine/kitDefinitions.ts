import { type DrumKitDef, type DrumVoiceDef } from '#/modules/Synth/models/DrumSynthTypes';
import { scheduleDrumVoice } from '#/modules/Synth/engine/drumSynthVoices';

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

export function findVoiceByNote(kit: DrumKitDef, midiNote: number): DrumVoiceDef | null {
    return kit.voices.find((v) => v.midiNote === midiNote) ?? null;
}

/**
 * Main entry point: schedule a drum hit for a given MIDI note within a kit.
 */
export function scheduleDrumKitNote(
    ctx: BaseAudioContext,
    dest: AudioNode,
    kit: DrumKitDef,
    midiNote: number,
    startTime: number,
    velocity: number,
    clipGain: number = 1.0
): void {
    const voice = findVoiceByNote(kit, midiNote);
    if (!voice) {
        return;
    }
    const scaledVelocity = Math.max(0, Math.min(127, velocity * clipGain));
    scheduleDrumVoice(ctx, dest, voice.type, startTime, scaledVelocity);
}
