import { audioEngine } from "../repositories/audioEngineInstance";

export const setMasterGain = (gain: number): void => {
    audioEngine.setMasterGain(gain);
};
