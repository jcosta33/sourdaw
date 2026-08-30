import { systemTimers, type TimerHandle, type Timers } from './timers.js';

/** A window-close wait must never strand the app behind a renderer that stopped responding. */
export const RENDERER_SESSION_QUIESCE_TIMEOUT_MS = 5_000;

export type RendererSessionWindow = {
    readonly isDestroyed: () => boolean;
    readonly webContents: { readonly send: (channel: string, requestId: number) => void };
};

export const createRendererSessionQuiescer = (
    channel: string,
    cancelChannelOrTimers: string | Timers = systemTimers,
    injectedTimers: Timers = systemTimers
) => {
    const cancelChannel = typeof cancelChannelOrTimers === 'string' ? cancelChannelOrTimers : `${channel}:cancel`;
    const timers = typeof cancelChannelOrTimers === 'string' ? injectedTimers : cancelChannelOrTimers;
    let requestId = 1;
    let pending:
        | {
              readonly window: RendererSessionWindow;
              readonly requestId: number;
              readonly timer: TimerHandle;
              started: boolean;
              readonly settle: (quiesced: boolean) => void;
          }
        | undefined;

    const cancel = (): void => {
        if (pending === undefined) {
            return;
        }
        if (!pending.started) {
            pending.settle(false);
            return;
        }
        try {
            pending.window.webContents.send(cancelChannel, pending.requestId);
        } catch {
            // The final request timeout keeps the native window open if a
            // disappearing renderer cannot acknowledge cancellation.
        }
    };

    return {
        request: (window: RendererSessionWindow): Promise<boolean> => {
            if (window.isDestroyed() || pending !== undefined) {
                return Promise.resolve(false);
            }
            const currentRequestId = requestId;
            requestId += 1;
            return new Promise<boolean>((resolve) => {
                let timer: TimerHandle | undefined;
                const settle = (quiesced: boolean): void => {
                    timer?.cancel();
                    pending = undefined;
                    resolve(quiesced);
                };
                timer = timers.setTimer(() => {
                    if (pending?.requestId === currentRequestId && pending.started) {
                        try {
                            pending.window.webContents.send(cancelChannel, currentRequestId);
                        } catch {
                            // The missing final acknowledgement still denies close.
                        }
                    }
                    settle(false);
                }, RENDERER_SESSION_QUIESCE_TIMEOUT_MS);
                pending = { window, requestId: currentRequestId, timer, started: false, settle };
                try {
                    window.webContents.send(channel, currentRequestId);
                } catch {
                    settle(false);
                }
            });
        },
        resolve: (window: RendererSessionWindow, completedRequestId: number, quiesced: boolean): void => {
            if (pending?.window === window && pending.requestId === completedRequestId) {
                pending.settle(quiesced);
            }
        },
        start: (window: RendererSessionWindow, startedRequestId: number): boolean => {
            if (pending?.window !== window || pending.requestId !== startedRequestId) {
                return false;
            }
            pending.started = true;
            return true;
        },
        cancel,
    };
};

/** Gate an approved native Close on the renderer-owned project-session drain. */
export const completeMacCloseAfterSessionQuiesce = async ({
    request,
    shouldProceed,
    close,
    cancel,
}: {
    readonly request: () => Promise<boolean>;
    readonly shouldProceed: () => boolean;
    readonly close: () => void;
    readonly cancel: () => void;
}): Promise<void> => {
    if (!shouldProceed()) {
        cancel();
        return;
    }
    if (!(await request()) || !shouldProceed()) {
        cancel();
        return;
    }
    close();
};
