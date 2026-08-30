import type { NativeMenuIntent } from './applicationMenu.js';

export type NativeMenuActionWindow = {
    readonly isDestroyed: () => boolean;
    readonly webContents: {
        readonly send: (channel: string, intent: NativeMenuIntent) => void;
    };
};

type CreateNativeMenuActionDispatcherInput = {
    readonly isMac: boolean;
    readonly actionChannel: string;
    readonly getWindow: () => NativeMenuActionWindow | undefined;
    readonly createWindow: () => NativeMenuActionWindow;
};

const canQueueForWindowlessRenderer = (intent: NativeMenuIntent): boolean =>
    intent.action === 'project:new' ||
    (intent.action === 'project:open-recent' && intent.recentKey !== undefined) ||
    ((intent.action === 'project:save' || intent.action === 'project:discard') &&
        intent.requestId !== undefined &&
        intent.projectKey !== undefined &&
        intent.revision !== undefined);

/** Routes live menu actions and safely queues supported project actions for a new macOS session window. */
export const createNativeMenuActionDispatcher = ({
    isMac,
    actionChannel,
    getWindow,
    createWindow,
}: CreateNativeMenuActionDispatcherInput) => {
    let pending: { readonly window: NativeMenuActionWindow; readonly intents: NativeMenuIntent[] } | undefined;

    const deliver = (window: NativeMenuActionWindow, intent: NativeMenuIntent): void => {
        window.webContents.send(actionChannel, intent);
    };

    return {
        /** Every new renderer starts unready; only windowless project transitions may wait for it. */
        registerWindow(window: NativeMenuActionWindow): void {
            if (window.isDestroyed() || pending !== undefined) {
                return;
            }
            pending = { window, intents: [] };
        },
        dispatch(intent: NativeMenuIntent): void {
            const window = getWindow();
            if (window !== undefined && !window.isDestroyed()) {
                if (pending?.window === window) {
                    if (canQueueForWindowlessRenderer(intent)) {
                        pending.intents.push(intent);
                    }
                    return;
                }
                deliver(window, intent);
                return;
            }
            if (!isMac || !canQueueForWindowlessRenderer(intent)) {
                return;
            }
            const createdWindow = createWindow();
            if (pending?.window === createdWindow) {
                pending.intents.push(intent);
                return;
            }
            pending = { window: createdWindow, intents: [intent] };
        },
        rendererReady(window: NativeMenuActionWindow): void {
            if (pending?.window !== window || getWindow() !== window || window.isDestroyed()) {
                return;
            }
            const intents = pending.intents;
            pending = undefined;
            for (const intent of intents) {
                deliver(window, intent);
            }
        },
        /** Carry only supported windowless actions across the renderer crash they created. */
        recoverPendingWindow(crashed: NativeMenuActionWindow, replacement: NativeMenuActionWindow): void {
            if (pending?.window !== crashed || replacement.isDestroyed()) {
                return;
            }
            pending = { window: replacement, intents: pending.intents };
        },
        /** Intentional or unrelated lifecycle transitions must never replay stale actions. */
        clearPending(window?: NativeMenuActionWindow): void {
            if (window === undefined || pending?.window === window) {
                pending = undefined;
            }
        },
    };
};
