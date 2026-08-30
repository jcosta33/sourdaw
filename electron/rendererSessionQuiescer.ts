import { systemTimers, type TimerHandle, type Timers } from './timers.js';

import type { RendererSessionQuiesceOutcome, RendererSessionQuiesceResult } from './channels.js';

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
              readonly settle: (outcome: RendererSessionQuiesceOutcome) => void;
          }
        | undefined;
    let recovering: { readonly window: RendererSessionWindow; readonly requestId: number } | undefined;
    let acknowledgedSuccess: { readonly window: RendererSessionWindow; readonly requestId: number } | undefined;
    let timedOutWindow: RendererSessionWindow | undefined;
    let terminalWindow: RendererSessionWindow | undefined;

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
            pending.settle('rejected');
            return;
        }
        requestRecovery(pending.window, pending.requestId);
        pending.settle('rejected');
    };

    return {
        request: (window: RendererSessionWindow): Promise<RendererSessionQuiesceOutcome> => {
            if (terminalWindow === window) {
                return Promise.resolve('terminal');
            }
            if (acknowledgedSuccess?.window === window) {
                return Promise.resolve('success');
            }
            if (
                window.isDestroyed() ||
                pending !== undefined ||
                recovering !== undefined ||
                acknowledgedSuccess !== undefined
            ) {
                return Promise.resolve('rejected');
            }
            const currentRequestId = requestId;
            requestId += 1;
            return new Promise<RendererSessionQuiesceOutcome>((resolve) => {
                let timer: TimerHandle | undefined;
                const settle = (outcome: RendererSessionQuiesceOutcome): void => {
                    timer?.cancel();
                    pending = undefined;
                    resolve(outcome);
                };
                timer = timers.setTimer(() => {
                    if (pending?.requestId === currentRequestId && pending.started) {
                        timedOutWindow = pending.window;
                        requestRecovery(pending.window, currentRequestId);
                    }
                    settle('rejected');
                }, RENDERER_SESSION_QUIESCE_TIMEOUT_MS);
                pending = { window, requestId: currentRequestId, timer, started: false, settle };
                try {
                    window.webContents.send(channel, currentRequestId);
                } catch {
                    settle('rejected');
                }
            });
        },
        resolve: (window: RendererSessionWindow, result: RendererSessionQuiesceResult): void => {
            if (pending?.window === window && pending.requestId === result.requestId) {
                timedOutWindow = undefined;
                if (result.outcome === 'success') {
                    acknowledgedSuccess = { window, requestId: result.requestId };
                } else if (result.outcome === 'terminal') {
                    terminalWindow = window;
                }
                pending.settle(result.outcome);
                return;
            }
            if (recovering?.window === window && recovering.requestId === result.requestId) {
                if (result.outcome === 'rejected') {
                    recovering = undefined;
                } else if (result.outcome === 'terminal') {
                    terminalWindow = window;
                    recovering = undefined;
                    timedOutWindow = undefined;
                }
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
            if (timedOutWindow === window) {
                timedOutWindow = undefined;
            }
            if (terminalWindow === window) {
                terminalWindow = undefined;
            }
            // A destroyed renderer cannot repair or complete its outstanding
            // request. Settling it directly is safe: there is no session left
            // to restore, and a replacement window must be able to admit its
            // own close request immediately.
            if (pending?.window === window) {
                pending.settle('rejected');
            }
            if (acknowledgedSuccess?.window === window) {
                acknowledgedSuccess = undefined;
            }
            if (recovering?.window === window) {
                recovering = undefined;
            }
        },
        cancel,
        timedOut: (window: RendererSessionWindow): boolean => timedOutWindow === window,
    };
};

/** Gate an approved native Close on the renderer-owned project-session drain. */
export const completeMacCloseAfterSessionQuiesce = async ({
    request,
    shouldProceed,
    close,
    cancel,
}: {
    readonly request: () => Promise<RendererSessionQuiesceOutcome>;
    readonly shouldProceed: () => boolean;
    readonly close: () => void;
    readonly cancel: () => void;
}): Promise<void> => {
    if (!shouldProceed()) {
        cancel();
        return;
    }
    if ((await request()) !== 'success' || !shouldProceed()) {
        cancel();
        return;
    }
    close();
};
