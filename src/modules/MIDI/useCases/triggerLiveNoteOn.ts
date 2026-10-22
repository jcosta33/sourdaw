import { admitMidiRecordingEvent } from './midiRecordingSession';
import { captureEventBeatAt } from './webMidiInput/captureEventBeat';
import { resolveInputEventTime, type CapturedInputEventTime } from './webMidiInput/resolveInputEventTime';
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

export function triggerLiveNoteOn(channel: number, note: number, velocity: number): Promise<void> {
    const time = { audioTime: resolveInputEventTime({ timeStamp: undefined }) };
    const eventTime = { ...time, recordingBeat: captureEventBeatAt(time) };
    const admission = admitMidiRecordingEvent({
        event: { type: 'noteOn', channel, note, velocity },
        time: eventTime,
    });
    const admittedTime: CapturedInputEventTime = {
        ...eventTime,
        ...(admission.disposition === 'captured' ? { recordingWitness: admission.witness } : {}),
        ...(admission.disposition === 'inactive' ? {} : { recordingAdmitted: true }),
    };
    return handleWebMidiNoteOn(channel, note, velocity, admittedTime);
}
