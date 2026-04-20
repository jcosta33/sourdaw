import { audioEngine } from '../../repositories/createWebAudioEngine';

export function updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void {
    audioEngine.updateDevicePatch(trackId, deviceId, patch);
}
