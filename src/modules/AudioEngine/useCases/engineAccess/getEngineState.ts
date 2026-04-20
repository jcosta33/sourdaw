import { type AudioEngineState } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getEngineState(): AudioEngineState {
    return audioEngine.getState();
}
