import { getCurrentTime, scheduleDeviceParam } from '#/modules/AudioEngine/useCases';

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
