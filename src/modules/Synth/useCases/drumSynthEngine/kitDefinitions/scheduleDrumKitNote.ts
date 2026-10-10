import { scheduleDrumVoice } from '../../../engine/drumSynthVoices';
import { type DrumKitDef } from '../../../models/DrumSynthTypes';

import { findVoiceByNote } from './findVoiceByNote';

/**
 * Main entry point: schedule a drum hit for a given MIDI note within a kit.
 *
 * Every drum voice scales its level linearly with the velocity it receives, so
 * the kit's linear `kitGain` is applied to the velocity after clip gain has
 * been folded in and clamped: the kit level then trims every hit by the same
 * ratio, however loud the note and clip are. A hit with no level left schedules
 * nothing, since a silent voice has nothing to play.
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
    const leveledVelocity = clippedVelocity * Math.max(0, kitGain);
    if (leveledVelocity <= 0) {
        return;
    }
    scheduleDrumVoice(ctx, dest, voice.type, startTime, leveledVelocity);
}
