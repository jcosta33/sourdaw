import { audioEngine } from "../repositories/audioEngineInstance";

export const initializeAudioEngine = async (): Promise<void> => {
    await audioEngine.initialize();
};
