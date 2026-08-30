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
    let recovering: { readonly window: RendererSessionWindow; readonly requestId: number } | undefined;
    let acknowledgedSuccess: { readonly window: RendererSessionWindow; readonly requestId: number } | undefined;

    const requestRecovery = (window: RendererSessionWindow, requestId: number): void => {
        recovering = { window, requestId };
        acknowledgedSuccess = undefined;
        try {
            window.webContents.send(cancelChannel, requestId);
        } catch {
            // A vanished renderer cannot acknowledge recovery; preserve the
            // recovery lock rather than admitting a second teardown.
        }
    };

    const cancel = (): void => {
        if (pending === undefined) {
            if (acknowledgedSuccess !== undefined) {
                requestRecovery(acknowledgedSuccess.window, acknowledgedSuccess.requestId);
            }
            return;
        }
        if (!pending.started) {
            pending.settle(false);
            return;
        }
        requestRecovery(pending.window, pending.requestId);
        pending.settle(false);
    };

    return {
        request: (window: RendererSessionWindow): Promise<boolean> => {
            if (
                window.isDestroyed() ||
                pending !== undefined ||
                recovering !== undefined ||
                acknowledgedSuccess !== undefined
            ) {
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
                        requestRecovery(pending.window, currentRequestId);
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
                if (quiesced) {
                    acknowledgedSuccess = { window, requestId: completedRequestId };
                }
                pending.settle(quiesced);
                return;
            }
            if (recovering?.window === window && recovering.requestId === completedRequestId && quiesced === false) {
                recovering = undefined;
            }
        },
        start: (window: RendererSessionWindow, startedRequestId: number): boolean => {
            if (pending?.window !== window || pending.requestId !== startedRequestId) {
                return false;
            }
            pending.started = true;
            return true;
        },
        finalize: (window: RendererSessionWindow): void => {
            // A destroyed renderer cannot repair or complete its outstanding
            // request. Settling it directly is safe: there is no session left
            // to restore, and a replacement window must be able to admit its
            // own close request immediately.
            if (pending?.window === window) {
                pending.settle(false);
            }
            if (acknowledgedSuccess?.window === window) {
                acknowledgedSuccess = undefined;
            }
            if (recovering?.window === window) {
                recovering = undefined;
            }
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
