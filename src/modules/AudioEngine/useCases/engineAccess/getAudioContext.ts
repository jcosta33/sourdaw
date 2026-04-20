import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getAudioContext(): AudioContext {
    return audioEngine.context;
}

export { audioEngine };
