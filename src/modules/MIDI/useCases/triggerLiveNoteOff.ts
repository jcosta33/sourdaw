import { admitMidiRecordingEvent } from './midiRecordingSession';
import { captureEventBeatAt } from './webMidiInput/captureEventBeat';
import { resolveInputEventTime, type CapturedInputEventTime } from './webMidiInput/resolveInputEventTime';
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

export function triggerLiveNoteOff(channel: number, note: number, releaseVelocity = 0): Promise<void> {
    const time = { audioTime: resolveInputEventTime({ timeStamp: undefined }) };
    const eventTime = { ...time, recordingBeat: captureEventBeatAt(time) };
    const admission = admitMidiRecordingEvent({ event: { type: 'noteOff', channel, note }, time: eventTime });
    const admittedTime: CapturedInputEventTime = {
        ...eventTime,
        ...(admission.disposition === 'captured' ? { recordingWitness: admission.witness } : {}),
        ...(admission.disposition === 'inactive' ? {} : { recordingAdmitted: true }),
    };
    return handleWebMidiNoteOff(channel, note, releaseVelocity, admittedTime);
}
