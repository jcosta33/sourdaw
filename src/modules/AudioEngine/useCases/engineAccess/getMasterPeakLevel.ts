import { audioEngine } from '../../repositories/createWebAudioEngine';

/** Linear master peak, or `null` when the engine has no meter tap to read. */
export function getMasterPeakLevel(): number | null {
    return audioEngine.getMasterPeakLevel();
}
