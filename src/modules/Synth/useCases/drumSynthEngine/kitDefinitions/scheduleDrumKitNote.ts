import { type DrumKitDef, type DrumVoiceDef } from '#/modules/Synth/models/DrumSynthTypes';
import { scheduleDrumVoice } from '#/modules/Synth/engine/drumSynthVoices';

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