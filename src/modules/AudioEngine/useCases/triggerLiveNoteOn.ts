/**
 * Trigger a live noteOn event on the currently selected track.
 * Routes through the AudioEngine message handler pipeline —
 * identical path to a physical MIDI controller or Web MIDI device.
 *
 * @param channel - MIDI channel (0 = omni / default)
 * @param note    - MIDI note number (0–127)
 * @param velocity - Note velocity (1–127)
 */
import { handleNoteOn } from '../repositories/webMidi/messageHandlers';

export function triggerLiveNoteOn(channel: number, note: number, velocity: number): void {
    handleNoteOn(channel, note, velocity);
}
