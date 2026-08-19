import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

export async function getDefaultPluginPaths(): Promise<string[]> {
    if (!isDesktopRuntime()) {
        return [];
    }
    return desktopInvoke('get_default_plugin_paths') as Promise<string[]>;
}
