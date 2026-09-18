import { scheduleDeviceKeyOff } from '../deviceControls/scheduleDeviceKeyOff';
import { scheduleDeviceKeyOn } from '../deviceControls/scheduleDeviceKeyOn';

/**
 * Schedule a Faust-synth note for timeline playback through the polyphonic
 * voice allocator (#3721).
 *
 * Faust instruments are compiled with `FaustPolyDspGenerator`, whose processor
 * only computes voices that `keyOn` allocated — plain freq/gain/gate parameter
 * writes land on no voice and render silence (free voices are skipped
 * entirely). `keyOn`/`keyOff` are the same dispatch the offline render uses
 * (`FaustDeviceStrategy.noteOn/noteOff` → `wamControls.keyOn/keyOff`), and
 * they voice overlapping notes independently instead of one parameter set
 * cutting the previous note off.
 *
 * The poly allocator maps velocity to voice gain as velocity/127, so scaling
 * velocity by clipGain reproduces the (velocity/127) * clipGain gain the old
 * parameter route wrote.
 */
export function scheduleFaustNote(
    trackId: string,
    deviceId: string,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    clipGain: number = 1.0
): void {
    scheduleDeviceKeyOn(trackId, deviceId, pitch, velocity * clipGain, startTime);
    scheduleDeviceKeyOff(trackId, deviceId, pitch, 0, startTime + duration);
}
