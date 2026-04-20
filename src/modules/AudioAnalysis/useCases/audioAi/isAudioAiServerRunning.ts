import { isAudioAiServerRunning as checkAudioAiServerStatus } from '../../repositories/audioAiEngine';

export function isAudioAiServerRunning(): Promise<boolean> {
    return checkAudioAiServerStatus();
}
