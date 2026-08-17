import { audioEngine } from '../../repositories/createWebAudioEngine';

export function addDeviceToStrip(
    trackId: string,
    deviceId: string,
    deviceType: string,
    externalInstanceId?: string,
    precedingDeviceIds?: readonly string[],
    parameterIds?: readonly string[]
): void {
    audioEngine.addDeviceToStrip(trackId, deviceId, deviceType, externalInstanceId, precedingDeviceIds, parameterIds);
}
