import { stopDictation as stopVoiceDictation } from '../../repositories/voiceTauriAdapter/stopDictation';

export function stopDictation(): Promise<void> {
    return stopVoiceDictation();
}