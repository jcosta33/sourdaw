/**
 * Trigger a live noteOn event on the currently selected track.
 * Routes through the AudioEngine message handler pipeline —
 * identical path to a physical MIDI controller or Web MIDI device.
 *
 * @param channel - MIDI channel (0 = omni / default)
 * @param note    - MIDI note number (0–127)
 * @param velocity - Note velocity (1–127)
 */
import { handleWebMidiNoteOn } from './webMidiInput/handleWebMidiNoteOn';
import { captureEventPositionAt } from './webMidiInput/captureEventBeat';
import { captureCompensatedRecordingPosition } from './webMidiInput/captureCompensatedRecordingPosition';
import { getTargetTrackId } from '../repositories/webMidi/getTargetTrackId';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { admitRecordingMidiNoteOn } from '#/modules/Arrangement/useCases';

export function triggerLiveNoteOn(channel: number, note: number, velocity: number): Promise<void> {
    const audioTime = audioEngine.context.currentTime;
    const position = captureEventPositionAt({ audioTime });
    const trackId = getTargetTrackId();
    const admission =
        velocity > 0 && trackId
            ? admitRecordingMidiNoteOn({
                  trackId,
                  channel,
                  note,
                  velocity,
                  audioTime,
                  position: captureCompensatedRecordingPosition(trackId, audioTime),
              })
            : null;
    return handleWebMidiNoteOn(channel, note, velocity, {
        audioTime,
        recordingBeat: position.beat,
        recordingPassIndex: position.passIndex,
        ...(admission ? { recordingAdmissionId: admission.id } : {}),
    });
}
