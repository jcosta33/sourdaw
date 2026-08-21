import { startDictation as startVoiceDictation } from '../../repositories/voiceNativeAdapter/startDictation';

export function startDictation(sessionId: string): Promise<string> {
    return startVoiceDictation(sessionId);
}
