import { audioEngine } from '../../repositories/createWebAudioEngine';

export function stopAllScheduled(): void {
    audioEngine.stopAllScheduled();
}
