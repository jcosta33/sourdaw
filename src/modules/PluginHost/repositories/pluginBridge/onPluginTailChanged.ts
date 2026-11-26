import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginTailChange } from './types';

function isPluginTailChange(value: unknown): value is PluginTailChange {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginTailChange>;
    return (
        typeof candidate.instance_id === 'string' &&
        typeof candidate.tail_samples === 'number' &&
        Number.isInteger(candidate.tail_samples) &&
        candidate.tail_samples >= 0 &&
        typeof candidate.sequence === 'number' &&
        Number.isSafeInteger(candidate.sequence) &&
        candidate.sequence > 0
    );
}

/**
 * Subscribe to `plugin-tail-changed`, pushed by the native host after a plugin
 * flagged that its processing tail moved and the host re-read it.
 *
 * Push, not poll: a preset loaded inside a reverb lengthens its decay without
 * this app hearing about it, and an export sized from the tail read at load
 * would cut the new one off. Browser dev mode has no native host, so it
 * subscribes to nothing and the unlisten is a no-op.
 */
export async function onPluginTailChanged(handler: (change: PluginTailChange) => void): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => {};
    }
    return desktopListen('plugin-tail-changed', (payload: unknown) => {
        const event = payload as { payload?: unknown };
        if (!isPluginTailChange(event.payload)) {
            return;
        }
        handler(event.payload);
    });
}
