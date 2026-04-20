import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setMasterGainValue(value: number): void {
    audioEngine.setMasterGain(value);
}
