import { isAudioAiServerRunning as checkAudioAiServerStatus } from '../../repositories/isAudioAiServerRunning';

export function isAudioAiServerRunning(): Promise<boolean> {
    return checkAudioAiServerStatus();
}
