import { desktopListen } from '#/utils/desktopBridge';

export type DictationResult = {
    text: string;
    duration_ms: number;
};

const MAX_DICTATION_TEXT_LENGTH = 32_768;
const MAX_DICTATION_DURATION_MS = 3_600_000;

/**
 * Subscribe to the dictation-result event emitted by Rust after transcription.
 * Returns an unlisten function to clean up the listener.
 */
export async function onDictationResult(handler: (result: DictationResult) => void): Promise<() => void> {
    const unlisten = await desktopListen('dictation-result', (payload: unknown) => {
        const result = readDictationResult(payload);
        if (result) {
            handler(result);
        }
    });
    return unlisten;
}

function readDictationResult(event: unknown): DictationResult | null {
    if (typeof event !== 'object' || event === null || !('payload' in event)) {
        return null;
    }
    const { payload } = event;
    if (typeof payload !== 'object' || payload === null || !('text' in payload) || !('duration_ms' in payload)) {
        return null;
    }
    const { text, duration_ms: durationMs } = payload;
    if (typeof text !== 'string' || text.length > MAX_DICTATION_TEXT_LENGTH) {
        return null;
    }
    if (
        typeof durationMs !== 'number' ||
        !Number.isInteger(durationMs) ||
        durationMs < 0 ||
        durationMs > MAX_DICTATION_DURATION_MS
    ) {
        return null;
    }
    return { text, duration_ms: durationMs };
}
