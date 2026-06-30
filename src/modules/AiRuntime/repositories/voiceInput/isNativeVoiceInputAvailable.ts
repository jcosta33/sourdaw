import { isTauri } from '#/utils/tauriBridge';

export function isNativeVoiceInputAvailable(): boolean {
    return isTauri();
}
