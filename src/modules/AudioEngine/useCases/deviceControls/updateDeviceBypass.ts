import { audioEngine } from '../../repositories/createWebAudioEngine';

export function updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void {
    audioEngine.updateDeviceBypass(trackId, deviceId, bypassed);
}
