/**
 * Trigger a live noteOff event on the currently selected track.
 * Routes through the AudioEngine message handler pipeline —
 * identical path to a physical MIDI controller or Web MIDI device.
 *
 * @param channel         - MIDI channel (0 = omni / default)
 * @param note            - MIDI note number (0–127)
 * @param releaseVelocity - Normalized (0..1) note-off velocity; defaults to 0
 *                          (no release dynamic) for callers without one.
 */
import { handleNoteOff } from '../repositories/webMidi/messageHandlers';

export function triggerLiveNoteOff(channel: number, note: number, releaseVelocity = 0): void {
    handleNoteOff(channel, note, releaseVelocity);
}
