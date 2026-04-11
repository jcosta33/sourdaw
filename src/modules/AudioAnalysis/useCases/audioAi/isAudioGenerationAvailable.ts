import { isAudioGenerationAvailable as checkAudioGenerationAvailability } from '../../repositories/audioAiEngine';

export function isAudioGenerationAvailable(): boolean {
    return checkAudioGenerationAvailability();
}