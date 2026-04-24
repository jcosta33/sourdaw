import { scheduleDeviceKeyOn, scheduleDeviceKeyOff } from '#/modules/AudioEngine/useCases';

export function scheduleFaustNote(
    trackId: string,
    deviceId: string,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    clipGain: number = 1.0
): void {
    const scaledVelocity = Math.max(0, Math.min(127, Math.floor(velocity * clipGain)));

    scheduleDeviceKeyOn(trackId, deviceId, pitch, scaledVelocity, startTime);
    scheduleDeviceKeyOff(trackId, deviceId, pitch, 0, startTime + duration);
}
