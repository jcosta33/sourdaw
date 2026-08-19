import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

export async function isPluginGuiSupported(instanceId: string): Promise<boolean> {
    if (!isDesktopRuntime()) {
        return false;
    }
    return desktopInvoke('is_plugin_gui_supported', { instanceId }) as Promise<boolean>;
}
