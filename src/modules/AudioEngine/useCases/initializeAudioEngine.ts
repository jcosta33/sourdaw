import { audioEngine } from "../repositories/audioEngineInstance";
import { transportStore } from "#/modules/Transport/stores/transportStore";

export const initializeAudioEngine = async (): Promise<void> => {
    await audioEngine.initialize();

    const transport = transportStore.value;
    if (transport) {
        audioEngine.setMasterGain(transport.masterGain / 100);
    }
};
