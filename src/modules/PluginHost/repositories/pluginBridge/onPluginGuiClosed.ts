import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginGuiClosed } from './types';

function isPluginGuiClosed(value: unknown): value is PluginGuiClosed {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginGuiClosed>;
    return typeof candidate.instance_id === 'string';
}

/**
 * Subscribe to `plugin-gui-closed`, pushed by the native host when the OS ended
 * a plugin editor window this side did not close.
 *
 * Push, not poll: the editor window belongs to the OS, and a title-bar close or
 * the owner-destroy cascade happens without any request from here. Browser dev
 * mode has no native host, so it subscribes to nothing and the unlisten is a
 * no-op.
 */
export async function onPluginGuiClosed(handler: (closed: PluginGuiClosed) => void): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => {};
    }
    return desktopListen('plugin-gui-closed', (payload: unknown) => {
        const event = payload as { payload?: unknown };
        if (!isPluginGuiClosed(event.payload)) {
            return;
        }
        handler(event.payload);
    });
}
