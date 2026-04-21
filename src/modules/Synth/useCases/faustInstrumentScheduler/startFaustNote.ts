import { getCurrentTime, scheduleDeviceKeyOn, scheduleDeviceKeyOff } from '#/modules/AudioEngine/useCases';

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
