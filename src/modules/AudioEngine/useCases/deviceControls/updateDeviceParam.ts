import { audioEngine } from '../../repositories/createWebAudioEngine';

export function updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
    audioEngine.updateDeviceParam(trackId, deviceId, paramId, value);
}
