import { audioEngine } from '../../repositories/createWebAudioEngine';

export function scheduleDeviceKeyOn(
    trackId: string,
    deviceId: string,
    pitch: number,
    velocity: number,
    time?: number
): void {
    audioEngine.scheduleDeviceKeyOn(trackId, deviceId, pitch, velocity, time);
}
