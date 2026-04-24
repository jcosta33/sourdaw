import { scheduleDeviceParam } from '../deviceControls/scheduleDeviceParam';

/**
 * Schedule a Faust-synth note by writing frequency/gain/gate device params.
 *
 * Lives in AudioEngine (previously Synth) so the Synth barrel does not have
 * an outgoing edge into AudioEngine/useCases — that edge was the canonical
 * `AudioEngine → Synth → AudioEngine` barrel cycle.
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
