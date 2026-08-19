import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginGuiInfo } from './types';

export async function openPluginGui(instanceId: string): Promise<PluginGuiInfo> {
    if (!isDesktopRuntime()) {
        return { has_gui: false, is_open: false, width: 0, height: 0 };
    }
    return desktopInvoke('open_plugin_gui', { instanceId }) as Promise<PluginGuiInfo>;
}
