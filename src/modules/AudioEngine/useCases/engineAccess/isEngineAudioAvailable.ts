import { audioEngine } from '../../repositories/createWebAudioEngine';

/** False when the engine fell back to its silent shim and no tap carries signal. */
export function isEngineAudioAvailable(): boolean {
    return audioEngine.isAudioAvailable();
}
