import { desktopStartVoiceDictation } from '#/utils/desktopBridge';

/** Begin native audio capture + Whisper inference session. */
export function startDictation(sessionId: string): Promise<string> {
    return desktopStartVoiceDictation(sessionId);
}
