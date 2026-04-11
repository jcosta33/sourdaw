import { startDictation as startVoiceDictation } from '../../repositories/voiceTauriAdapter/startDictation';

export function startDictation(): Promise<void> {
    return startVoiceDictation();
}