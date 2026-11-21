import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getAudioTime(): number {
    return audioEngine.context?.currentTime ?? 0;
}
