import { audioEngine } from '../../repositories/createWebAudioEngine';

export function resumeEngine(): Promise<void> {
    return audioEngine.resume();
}
