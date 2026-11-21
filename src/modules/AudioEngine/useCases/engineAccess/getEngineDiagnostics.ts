import { audioEngine } from '../../repositories/createWebAudioEngine';

import type { AudioEngineDiagnostics } from '../../models/AudioEngineState';

export function getEngineDiagnostics(): AudioEngineDiagnostics {
    return audioEngine.getDiagnostics();
}
