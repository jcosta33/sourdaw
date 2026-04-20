import { audioEngine } from '../../repositories/createWebAudioEngine';

export function waitForDevices(): Promise<void> {
    return audioEngine.waitForDevices();
}
