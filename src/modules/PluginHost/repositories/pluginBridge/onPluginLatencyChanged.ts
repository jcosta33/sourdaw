import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginLatencyChange } from './types';

function isPluginLatencyChange(value: unknown): value is PluginLatencyChange {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginLatencyChange>;
    return typeof candidate.instance_id === 'string' && Number.isFinite(candidate.latency_ms);
}

/**
 * Subscribe to `plugin-latency-changed`, pushed by the native host after a
 * plugin flagged a runtime latency change and the host re-queried it (PH-4).
 *
 * Push, not poll: nothing on this side asks for latency, so a plugin that
 * changes latency mid-session (oversampling toggled, lookahead enabled) reaches
 * compensation without the UI knowing to look. Browser dev mode has no native
 * host, so it subscribes to nothing and the unlisten is a no-op.
 */
export async function onPluginLatencyChanged(handler: (change: PluginLatencyChange) => void): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => {};
    }
    return desktopListen('plugin-latency-changed', (payload: unknown) => {
        const event = payload as { payload?: unknown };
        if (!isPluginLatencyChange(event.payload)) {
            return;
        }
        handler(event.payload);
    });
}
