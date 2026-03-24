import { audioEngine } from '../repositories/createWebAudioEngine';

export function setMasterGain(gain: number): void {
    audioEngine.setMasterGain(gain);
}
