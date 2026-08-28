import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginStateDirty } from './types';

function isPluginStateDirty(value: unknown): value is PluginStateDirty {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginStateDirty>;
    return typeof candidate.instance_id === 'string';
}

/**
 * Subscribe to `plugin-state-dirty`, pushed by the native host after a plugin
 * reported that its own state changed.
 *
 * Push, not poll: an edit made inside a plugin's editor never passes through
 * this app, so nothing here would know to ask. Browser dev mode has no native
 * host, so it subscribes to nothing and the unlisten is a no-op.
 */
export async function onPluginStateDirty(handler: (dirty: PluginStateDirty) => void): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => {};
    }
    return desktopListen('plugin-state-dirty', (payload: unknown) => {
        const event = payload as { payload?: unknown };
        if (!isPluginStateDirty(event.payload)) {
            return;
        }
        handler(event.payload);
    });
}
