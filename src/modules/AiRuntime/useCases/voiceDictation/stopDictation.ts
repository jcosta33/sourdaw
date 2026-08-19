import { stopDictation as stopVoiceDictation } from '../../repositories/voiceNativeAdapter/stopDictation';

export function stopDictation(): Promise<void> {
    return stopVoiceDictation();
}
