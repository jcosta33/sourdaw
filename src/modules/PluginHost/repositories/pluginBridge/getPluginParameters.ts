import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginParameter } from './types';

export async function getPluginParameters(instanceId: string): Promise<PluginParameter[]> {
    if (!isDesktopRuntime()) {
        return [];
    }
    return desktopInvoke('get_plugin_parameters', { instanceId }) as Promise<PluginParameter[]>;
}
