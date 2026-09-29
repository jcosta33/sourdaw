import { audioEngine } from '../../repositories/createWebAudioEngine';

export function waitForDevices(): ReturnType<typeof audioEngine.waitForDevices> {
    return audioEngine.waitForDevices();
}
