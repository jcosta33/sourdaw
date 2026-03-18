import { audioEngine } from '../repositories/audioEngineInstance';

export function setMasterGain(gain: number): void {
    audioEngine.setMasterGain(gain);
}
