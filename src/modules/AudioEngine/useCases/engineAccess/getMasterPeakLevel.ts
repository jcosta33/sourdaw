import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getMasterPeakLevel(): number {
    return audioEngine.getMasterPeakLevel();
}