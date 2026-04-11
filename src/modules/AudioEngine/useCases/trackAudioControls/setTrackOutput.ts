import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setTrackOutput(trackId: string, outputId: string): void {
    audioEngine.setTrackOutput(trackId, outputId);
}