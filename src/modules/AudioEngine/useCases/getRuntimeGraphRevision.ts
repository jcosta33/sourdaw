import { audioEngine } from '../repositories/createWebAudioEngine';

export function getRuntimeGraphRevision(): number {
    return audioEngine.getRuntimeGraphRevision();
}
