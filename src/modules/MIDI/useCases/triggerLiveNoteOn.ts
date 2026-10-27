/**
 * Trigger a live noteOn event on the currently selected track.
 * Routes through the AudioEngine message handler pipeline —
 * identical path to a physical MIDI controller or Web MIDI device.
 *
 * @param channel - MIDI channel (0 = omni / default)
 * @param note    - MIDI note number (0–127)
 * @param velocity - Note velocity (1–127)
 */
import { admitRecordingMidiNoteOn } from '#/modules/Arrangement/useCases';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getTargetTrackId } from '../repositories/webMidi/getTargetTrackId';

import { captureCompensatedRecordingPosition } from './webMidiInput/captureCompensatedRecordingPosition';
import { captureEventPositionAt } from './webMidiInput/captureEventBeat';
import { captureRecordingMemberExpression } from './webMidiInput/captureRecordingMemberExpression';
import { handleWebMidiNoteOn } from './webMidiInput/handleWebMidiNoteOn';

export function triggerLiveNoteOn(channel: number, note: number, velocity: number): Promise<void> {
    if (transportStore.value?.isRecording !== true) {
        return handleWebMidiNoteOn(channel, note, velocity);
    }
    const audioTime = audioEngine.context.currentTime;
    const position = captureEventPositionAt({ audioTime });
    const trackId = getTargetTrackId();
    let admission: ReturnType<typeof admitRecordingMidiNoteOn> = null;
    if (velocity > 0 && trackId) {
        admission = admitRecordingMidiNoteOn({
            trackId,
            channel,
            note,
            velocity,
            audioTime,
            position: captureCompensatedRecordingPosition(trackId, audioTime),
            initialExpression: captureRecordingMemberExpression(channel),
        });
    }
    const time: {
        audioTime: number;
        recordingBeat: number;
        recordingPassIndex: number;
        recordingAdmissionId?: string;
    } = {
        audioTime,
        recordingBeat: position.beat,
        recordingPassIndex: position.passIndex,
    };
    if (admission) {
        time.recordingAdmissionId = admission.id;
    }
    return handleWebMidiNoteOn(channel, note, velocity, time);
}
