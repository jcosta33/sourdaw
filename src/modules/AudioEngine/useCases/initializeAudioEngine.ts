import { audioEngine } from '../repositories/audioEngineInstance';
import { getTransportStoreValue } from '#/modules/Transport/useCases/transportQueries';

export async function initializeAudioEngine(): Promise<void> {
    await audioEngine.initialize();

    const transport = getTransportStoreValue();
    if (transport) {
        audioEngine.setMasterGain(transport.masterGain / 100);
    }
}
