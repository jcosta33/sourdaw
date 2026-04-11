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

import { inject } from '#/infra/di/inject';
import { getCurrentTime, scheduleDeviceParam } from '#/modules/AudioEngine/useCases';

/**
 * Schedule a note on a Faust instrument.
 * Sets freq, gain, and gate AudioParams with proper timing via the AudioEngine.
 */
export const scheduleFaustNote = inject({ scheduleDeviceParam })(({ scheduleDeviceParam: scheduleParam }) => {
    return function scheduleFaustNote(
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

        scheduleParam(trackId, deviceId, 'freq', frequency, startTime);
        scheduleParam(trackId, deviceId, 'gain', gain, startTime);
        scheduleParam(trackId, deviceId, 'gate', 1, startTime);
        scheduleParam(trackId, deviceId, 'gate', 0, startTime + duration);
    };
});

/**
 * Start a sustained note on a Faust instrument (for audition / live play).
 * Returns a stop callback.
 */
export const startFaustNote = inject({ scheduleDeviceParam, getCurrentTime })(
    ({ scheduleDeviceParam: scheduleParam, getCurrentTime: getTime }) => {
        return function startFaustNote(
            trackId: string,
            deviceId: string,
            pitch: number,
            velocity: number,
            currentTime: number
        ): () => void {
            const frequency = 440 * 2 ** ((pitch - 69) / 12);
            const gain = velocity / 127;

            scheduleParam(trackId, deviceId, 'freq', frequency, currentTime);
            scheduleParam(trackId, deviceId, 'gain', gain, currentTime);
            scheduleParam(trackId, deviceId, 'gate', 1, currentTime);

            return () => {
                scheduleParam(trackId, deviceId, 'gate', 0, getTime());
            };
        };
    }
);
