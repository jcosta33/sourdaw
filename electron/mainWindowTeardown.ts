import { interceptOwnerWindowTeardown, type OwnerWindow, type PluginWindowHost } from './pluginGui.js';

/**
 * Detach parented plugin editors before the DAW window can be destroyed.
 *
 * Absent when the addon never registered a window host: there are then no
 * editors to un-parent, and close/destroy stay the platform's.
 */
export const bindMainWindowOwnerTeardown = (
    owner: OwnerWindow,
    host: PluginWindowHost | undefined
): (() => Promise<void>) | undefined => {
    if (host === undefined) {
        return undefined;
    }
    const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(owner, () => host.detachOpenEditors());
    return destroyAfterEditorsDetach;
};

/**
 * Destroy a crashed main window without CloseImmediately on parented editors.
 *
 * Uses the detach-first destroy captured before a replacement window rebinds
 * teardown to itself; falls back to the platform destroy only when no host was
 * registered.
 */
export const destroyCrashedMainWindow = (
    crashedWindow: OwnerWindow,
    destroyAfterEditorsDetach: (() => Promise<void>) | undefined
): void => {
    if (crashedWindow.isDestroyed()) {
        return;
    }
    if (destroyAfterEditorsDetach !== undefined) {
        void destroyAfterEditorsDetach();
        return;
    }
    crashedWindow.destroy();
};
