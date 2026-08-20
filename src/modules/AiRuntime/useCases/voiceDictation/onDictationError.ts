import { onDictationError as onVoiceDictationError } from '../../repositories/voiceNativeAdapter/onDictationError';

export type DictationError = {
    message: string;
};

export function onDictationError(handler: (error: DictationError) => void): Promise<() => void> {
    return onVoiceDictationError(handler);
}
