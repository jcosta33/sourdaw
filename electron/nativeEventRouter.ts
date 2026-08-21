import { VOICE_DICTATION_TERMINAL_CHANNEL } from './channels.js';

type NativeEventForwarder = { readonly emit: (event: string, payload: unknown) => void };
type RendererTarget = {
    readonly isDestroyed: () => boolean;
    readonly send: (channel: string, ...args: readonly unknown[]) => void;
};

/**
 * Dictation terminals carry private speech data, so they bypass the generic
 * renderer event fan-out and are delivered only on the correlated voice IPC.
 */
export const forwardNativeEvent = (
    event: string,
    payload: unknown,
    events: NativeEventForwarder,
    rendererTarget: () => RendererTarget | undefined
): void => {
    if (event !== 'dictation-result' && event !== 'dictation-error') {
        events.emit(event, payload);
        return;
    }
    try {
        const target = rendererTarget();
        if (target !== undefined && !target.isDestroyed()) {
            target.send(VOICE_DICTATION_TERMINAL_CHANNEL, event, payload);
        }
    } catch {
        // Terminal dictation data is fire-and-forget when the renderer exited.
    }
};
