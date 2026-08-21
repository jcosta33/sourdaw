import { desktopListen } from '#/utils/desktopBridge';

export type DictationError = {
    session_id: string;
    message: string;
};

const MAX_DICTATION_ERROR_MESSAGE_LENGTH = 2_048;

/**
 * Subscribe to the dictation-error event emitted by Rust when mic capture,
 * resampling, or transcription fails, or when a transcription result cannot
 * be delivered. Returns an unlisten function to clean up the listener.
 */
export async function onDictationError(handler: (error: DictationError) => void): Promise<() => void> {
    const unlisten = await desktopListen('dictation-error', (payload: unknown) => {
        const error = readDictationError(payload);
        if (error) {
            handler(error);
        }
    });
    return unlisten;
}

function readDictationError(event: unknown): DictationError | null {
    if (typeof event !== 'object' || event === null || !('payload' in event)) {
        return null;
    }
    const { payload } = event;
    if (typeof payload !== 'object' || payload === null || !('session_id' in payload) || !('message' in payload)) {
        return null;
    }
    const { session_id: sessionId, message } = payload;
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
        return null;
    }
    if (typeof message !== 'string' || message.length === 0 || message.length > MAX_DICTATION_ERROR_MESSAGE_LENGTH) {
        return null;
    }
    return { session_id: sessionId, message };
}
