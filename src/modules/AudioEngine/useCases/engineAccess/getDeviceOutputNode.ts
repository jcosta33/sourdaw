import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getDeviceOutputNode(deviceId: string): AudioNode | null {
    return audioEngine.findDeviceOutputNode(deviceId);
}
