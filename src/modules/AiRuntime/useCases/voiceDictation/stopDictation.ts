import { stopDictation as stopVoiceDictation } from '../../repositories/voiceNativeAdapter/stopDictation';

export function stopDictation(sessionId: string): Promise<void> {
    return stopVoiceDictation(sessionId);
}
