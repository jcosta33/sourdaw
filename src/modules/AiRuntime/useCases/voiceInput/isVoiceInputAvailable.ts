import { resolveVoiceInputMode } from './resolveVoiceInputMode';

export function isVoiceInputAvailable(): boolean {
    return resolveVoiceInputMode() !== null;
}
