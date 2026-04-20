import { audioEngine } from '../../repositories/createWebAudioEngine';

export function scheduleDeviceParam(
    trackId: string,
    deviceId: string,
    paramId: string,
    value: number,
    time: number
): void {
    audioEngine.scheduleDeviceParam(trackId, deviceId, paramId, value, time);
}
