import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getCurrentTime(): number {
    return audioEngine.context.currentTime;
}
