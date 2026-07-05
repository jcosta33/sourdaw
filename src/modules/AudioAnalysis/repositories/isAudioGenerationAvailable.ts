import { isTauri } from '#/utils/tauriBridge';

export function isAudioGenerationAvailable(): boolean {
    return isTauri();
}
