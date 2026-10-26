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
import { handleWebMidiNoteOff } from './webMidiInput/handleWebMidiNoteOff';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { admitRecordingMidiNoteOff, findOpenRecordingMidiAdmission } from '#/modules/Arrangement/useCases';
import { captureCompensatedRecordingPosition } from './webMidiInput/captureCompensatedRecordingPosition';

export function triggerLiveNoteOff(channel: number, note: number, releaseVelocity = 0): Promise<void> {
    const audioTime = audioEngine.context.currentTime;
    const opened = findOpenRecordingMidiAdmission(channel, note);
    if (opened) {
        admitRecordingMidiNoteOff({
            channel,
            note,
            audioTime,
            position: captureCompensatedRecordingPosition(opened.trackId, audioTime),
        });
    }
    return handleWebMidiNoteOff(channel, note, releaseVelocity, { audioTime });
}
