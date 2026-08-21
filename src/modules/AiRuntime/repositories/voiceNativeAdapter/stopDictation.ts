import { desktopStopVoiceDictation } from '#/utils/desktopBridge';

/** Stop capture and trigger Whisper transcription. */
export function stopDictation(sessionId: string): Promise<void> {
    return desktopStopVoiceDictation(sessionId);
}
