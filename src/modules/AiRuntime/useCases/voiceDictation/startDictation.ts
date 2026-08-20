import { startDictation as startVoiceDictation } from '../../repositories/voiceNativeAdapter/startDictation';

export function startDictation(): Promise<void> {
    return startVoiceDictation();
}
