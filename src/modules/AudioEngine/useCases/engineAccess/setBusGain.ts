import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setBusGain(busId: string, gain: number): void {
    audioEngine.setBusGain(busId, gain);
}
