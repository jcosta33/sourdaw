import { audioEngine } from '../../repositories/createWebAudioEngine';

import type { AudioEngineHealth } from '../../models/AudioEngineState';

export function getEngineHealth(): AudioEngineHealth {
    return audioEngine.getHealth();
}
