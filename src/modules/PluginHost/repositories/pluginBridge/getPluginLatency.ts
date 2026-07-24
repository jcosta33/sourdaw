import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

/**
 * Pull a native plugin's current latency in samples, applying any pending
 * runtime latency change host-side first (the `get_plugin_latency` Tauri command,
 * PH-4). Browser dev mode has no native host, so it reports zero latency.
 */
export async function getPluginLatency(instanceId: string): Promise<number> {
    if (!isTauri()) {
        return 0;
    }
    return tauriInvoke('get_plugin_latency', { instanceId }) as Promise<number>;
}
