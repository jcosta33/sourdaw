import { desktopCancelVoiceDictation } from '#/utils/desktopBridge';

/** Cancel capture and suppress any terminal text for the exact native session. */
export function cancelDictation(sessionId: string): Promise<void> {
    return desktopCancelVoiceDictation(sessionId);
}
