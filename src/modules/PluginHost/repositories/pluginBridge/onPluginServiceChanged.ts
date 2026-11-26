import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginServiceChange } from './types';

function isPluginServiceChange(value: unknown): value is PluginServiceChange {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginServiceChange>;
    return (
        typeof candidate.instance_id === 'string' &&
        (candidate.out_of_service_reason === null || typeof candidate.out_of_service_reason === 'string')
    );
}

/**
 * Subscribe to `plugin-service-changed`, pushed by the native host when it takes
 * a hosted instance out of service (the plugin refused to start processing, or a
 * VST3 bus layout the host cannot route) or puts it back.
 *
 * Push, not poll: the state is latched on the audio thread, and an instance out
 * of service plays dry or silent while its slot looks healthy unless this
 * arrives. Browser dev mode has no native host, so it subscribes to nothing and
 * the unlisten is a no-op.
 */
export async function onPluginServiceChanged(handler: (change: PluginServiceChange) => void): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => {};
    }
    return desktopListen('plugin-service-changed', (payload: unknown) => {
        const event = payload as { payload?: unknown };
        if (!isPluginServiceChange(event.payload)) {
            return;
        }
        handler(event.payload);
    });
}
