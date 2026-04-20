import { tauriListen } from '#/utils/tauriBridge';

export type DictationResult = {
    text: string;
    duration_ms: number;
};

/**
 * Subscribe to the dictation-result event emitted by Rust after transcription.
 * Returns an unlisten function to clean up the listener.
 */
export async function onDictationResult(handler: (result: DictationResult) => void): Promise<() => void> {
    const unlisten = await tauriListen('dictation-result', (payload: unknown) => {
        const event = payload as { payload: DictationResult };
        handler(event.payload);
    });
    return unlisten;
}
