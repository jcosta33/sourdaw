import { audioEngine } from '../../repositories/createWebAudioEngine';

export function addDeviceToStrip(
    trackId: string,
    deviceId: string,
    deviceType: string,
    externalInstanceId?: string
): void {
    audioEngine.addDeviceToStrip(trackId, deviceId, deviceType, externalInstanceId);
}