import { scheduleDrumVoice } from '../../../engine/drumSynthVoices';
import { type DrumKitDef } from '../../../models/DrumSynthTypes';

import { findVoiceByNote } from './findVoiceByNote';

/**
 * Main entry point: schedule a drum hit for a given MIDI note within a kit.
 *
 * Clip gain sets the legacy clamped velocity. Kit output trim scales every
 * amplitude-envelope point separately, preserving the hit's decay and timbre.
 * A hit left with no level schedules nothing.
 */
export function scheduleDrumKitNote(
    ctx: BaseAudioContext,
    dest: AudioNode,
    kit: DrumKitDef,
    midiNote: number,
    startTime: number,
    velocity: number,
    clipGain: number,
    kitGain: number
): void {
    const voice = findVoiceByNote(kit, midiNote);
    if (!voice) {
        return;
    }
    const clippedVelocity = Math.max(0, Math.min(127, velocity * clipGain));
    const outputGain = Math.max(0, kitGain);
    if (clippedVelocity <= 0 || outputGain <= 0) {
        return;
    }
    scheduleDrumVoice(ctx, dest, voice.type, startTime, clippedVelocity, outputGain);
}
