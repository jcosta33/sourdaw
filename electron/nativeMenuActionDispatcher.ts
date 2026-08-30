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
    intent.action === 'project:new' || (intent.action === 'project:open-recent' && intent.recentKey !== undefined);

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
        dispatch(intent: NativeMenuIntent): void {
            const window = getWindow();
            if (window !== undefined && !window.isDestroyed()) {
                if (pending?.window === window) {
                    pending.intents.push(intent);
                    return;
                }
                deliver(window, intent);
                return;
            }
            if (!isMac || !canQueueForWindowlessRenderer(intent)) {
                return;
            }
            const createdWindow = createWindow();
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
    };
};
