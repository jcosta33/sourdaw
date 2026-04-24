import { audioEngine } from '../../repositories/createWebAudioEngine';

export function scheduleDeviceKeyOff(
    trackId: string,
    deviceId: string,
    pitch: number,
    velocity: number,
    time?: number
): void {
    audioEngine.scheduleDeviceKeyOff(trackId, deviceId, pitch, velocity, time);
}
