import { isAudioGenerationAvailable as checkAudioGenerationAvailability } from '../../repositories/isAudioGenerationAvailable';

export function isAudioGenerationAvailable(): boolean {
    return checkAudioGenerationAvailability();
}
