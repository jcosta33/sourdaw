import { audioEngine } from '../../repositories/createWebAudioEngine';
import { type AudioEngineState } from '../../models/AudioEngineState';

export function getEngineState(): AudioEngineState {
    return audioEngine.getState();
}