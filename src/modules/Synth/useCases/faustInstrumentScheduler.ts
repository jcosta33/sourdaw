/**
 * Faust instrument note scheduling.
 *
 * Routes MIDI note events to Faust AudioWorkletNode parameters (freq, gain, gate)
 * instead of creating builtin oscillator nodes.
 *
 * Faust instruments are monophonic generators — they use button("gate"),
 * hslider("freq"), and hslider("gain") as standard Faust UI controls.
 *
 * IMPORTANT: faustwasm names AudioParams with full Faust address paths,
 * e.g. "/Physical_Model_String/freq" instead of just "freq".
 * We resolve params by matching the last path segment.
 */

import { scheduleDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { getCurrentTime } from '#/modules/AudioEngine/useCases/scheduling';

/**
 * Schedule a note on a Faust instrument.
 * Sets freq, gain, and gate AudioParams with proper timing via the AudioEngine.
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
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const gain = (velocity / 127) * clipGain;

    scheduleDeviceParam(trackId, deviceId, 'freq', frequency, startTime);
    scheduleDeviceParam(trackId, deviceId, 'gain', gain, startTime);
    scheduleDeviceParam(trackId, deviceId, 'gate', 1, startTime);
    scheduleDeviceParam(trackId, deviceId, 'gate', 0, startTime + duration);
}

/**
 * Start a sustained note on a Faust instrument (for audition / live play).
 * Returns a stop callback.
 */
export function startFaustNote(
    trackId: string,
    deviceId: string,
    pitch: number,
    velocity: number,
    currentTime: number
): () => void {
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const gain = velocity / 127;

    scheduleDeviceParam(trackId, deviceId, 'freq', frequency, currentTime);
    scheduleDeviceParam(trackId, deviceId, 'gain', gain, currentTime);
    scheduleDeviceParam(trackId, deviceId, 'gate', 1, currentTime);

    return () => {
        scheduleDeviceParam(trackId, deviceId, 'gate', 0, getCurrentTime());
    };
}
