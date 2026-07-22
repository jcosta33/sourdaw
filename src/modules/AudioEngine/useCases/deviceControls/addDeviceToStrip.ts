import { audioEngine } from '../../repositories/createWebAudioEngine';

export function addDeviceToStrip(
    trackId: string,
    deviceId: string,
    deviceType: string,
    externalInstanceId?: string,
    externalPluginId?: string
): void {
    if (externalPluginId === undefined) {
        audioEngine.addDeviceToStrip(trackId, deviceId, deviceType, externalInstanceId);
        return;
    }
    audioEngine.addDeviceToStrip(trackId, deviceId, deviceType, externalInstanceId, externalPluginId);
}
