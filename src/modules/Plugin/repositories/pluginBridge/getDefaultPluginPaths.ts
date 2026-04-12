import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

export async function getDefaultPluginPaths(): Promise<string[]> {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke('get_default_plugin_paths') as Promise<string[]>;
}
