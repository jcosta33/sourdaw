import { cancelDictation as cancelNativeDictation } from '../../repositories/voiceNativeAdapter/cancelDictation';

/** Cancel a native dictation session before it can emit draft text. */
export function cancelDictation(sessionId: string): Promise<void> {
    return cancelNativeDictation(sessionId);
}
