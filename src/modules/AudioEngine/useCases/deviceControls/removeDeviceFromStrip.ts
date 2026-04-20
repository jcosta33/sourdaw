import { audioEngine } from '../../repositories/createWebAudioEngine';

export function removeDeviceFromStrip(trackId: string, deviceId: string): void {
    audioEngine.removeDeviceFromStrip(trackId, deviceId);
}
