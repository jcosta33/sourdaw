import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginParametersRescanned } from './types';

function isPluginParametersRescanned(value: unknown): value is PluginParametersRescanned {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginParametersRescanned>;
    return typeof candidate.instance_id === 'string';
}

/**
 * Subscribe to `plugin-parameters-rescanned`, pushed by the native host after a
 * plugin announced that its parameter contract moved.
 *
 * Push, not poll: a preset loaded inside a plugin renames and rescales its
 * controls without this app hearing about it, and the automation menu would keep
 * offering the names and ranges the plugin had at load time. Browser dev mode
 * has no native host, so it subscribes to nothing and the unlisten is a no-op.
 */
export async function onPluginParametersRescanned(
    handler: (rescanned: PluginParametersRescanned) => void
): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => {};
    }
    return desktopListen('plugin-parameters-rescanned', (payload: unknown) => {
        const event = payload as { payload?: unknown };
        if (!isPluginParametersRescanned(event.payload)) {
            return;
        }
        handler(event.payload);
    });
}
