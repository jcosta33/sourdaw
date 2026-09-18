import { scheduleDeviceKeyOff } from '../deviceControls/scheduleDeviceKeyOff';
import { scheduleDeviceKeyOn } from '../deviceControls/scheduleDeviceKeyOn';
import { getCurrentTime } from '../scheduling/getCurrentTime';

/**
 * Start a Faust-synth note for interactive preview (piano-roll audition, Web
 * MIDI input); returns a function that releases the note.
 *
 * Notes go through the polyphonic voice allocator (`keyOn`/`keyOff`, the same
 * dispatch the offline render and `scheduleFaustNote` use) so a fresh
 * instrument processor actually voices the note and overlapping notes hold
 * independent voices (#3721). The poly allocator maps velocity to voice gain
 * as velocity/127. Lives in AudioEngine (previously Synth) to remove the
 * `Synth → AudioEngine` static edge.
 */
export function startFaustNote(
    trackId: string,
    deviceId: string,
    pitch: number,
    velocity: number,
    currentTime: number
): () => void {
    scheduleDeviceKeyOn(trackId, deviceId, pitch, velocity, currentTime);

    return () => {
        scheduleDeviceKeyOff(trackId, deviceId, pitch, 0, getCurrentTime());
    };
}
