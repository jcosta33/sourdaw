import {
    interceptOwnerWindowTeardown,
    type OwnerTeardownOptions,
    type OwnerWindow,
    type PluginWindowHost,
} from './pluginGui.js';

/**
 * Detach parented plugin editors before the DAW window can be destroyed.
 *
 * Absent when the addon never registered a window host: there are then no
 * editors to un-parent, and close/destroy stay the platform's.
 */
export const bindMainWindowOwnerTeardown = (
    owner: OwnerWindow,
    host: PluginWindowHost | undefined,
    shouldProceed?: () => boolean,
    onCancelled?: () => void,
    onDestroying?: () => void,
    shouldInterceptClose?: () => boolean,
    options?: OwnerTeardownOptions
): ((force?: boolean) => Promise<boolean>) | undefined => {
    if (host === undefined) {
        return undefined;
    }
    const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(
        owner,
        () => host.detachOpenEditors(),
        shouldProceed,
        onCancelled,
        onDestroying,
        shouldInterceptClose,
        options
    );
    return destroyAfterEditorsDetach;
};

/** Ignore a delayed dying-window callback once a replacement owns the session. */
export const notifyCurrentWindowDestroying = ({
    isCurrentWindow,
    notify,
}: {
    readonly isCurrentWindow: () => boolean;
    readonly notify: () => void;
}): void => {
    if (isCurrentWindow()) {
        notify();
    }
};

/** An approved renderer that crashed has no interactive session left to drain. */
export const isApprovedRendererTerminal = ({
    owner,
    currentWindow,
    permitsClose,
}: {
    readonly owner: OwnerWindow;
    readonly currentWindow: () => OwnerWindow | undefined;
    readonly permitsClose: () => boolean;
}): boolean => permitsClose() && currentWindow() !== owner;

/**
 * Destroy a crashed main window without CloseImmediately on parented editors.
 *
 * Uses the detach-first destroy captured before a replacement window rebinds
 * teardown to itself; falls back to the platform destroy only when no host was
 * registered.
 */
export const destroyCrashedMainWindow = (
    crashedWindow: OwnerWindow,
    destroyAfterEditorsDetach: ((force?: boolean) => Promise<boolean>) | undefined
): void => {
    if (crashedWindow.isDestroyed()) {
        return;
    }
    if (destroyAfterEditorsDetach !== undefined) {
        void destroyAfterEditorsDetach(true);
        return;
    }
    crashedWindow.destroy();
};
