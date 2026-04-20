import { audioEngine } from '../../repositories/createWebAudioEngine';

export function createBufferSource(): AudioBufferSourceNode {
    return audioEngine.context.createBufferSource();
}
