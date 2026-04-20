import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setTrackGain(trackId: string, gain: number): void {
    audioEngine.setTrackGain(trackId, gain);
}
