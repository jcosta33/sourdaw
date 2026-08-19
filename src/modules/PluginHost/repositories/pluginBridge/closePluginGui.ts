import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

export async function closePluginGui(instanceId: string): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('close_plugin_gui', { instanceId });
}
