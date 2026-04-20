import { audioEngine } from '../../repositories/createWebAudioEngine';

export function resetAudioGraph(): void {
    audioEngine.resetGraph();
}
