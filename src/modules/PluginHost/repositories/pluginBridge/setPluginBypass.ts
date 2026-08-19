import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

type SetPluginBypassInput = {
    instanceId: string;
    bypassed: boolean;
};

export async function setPluginBypass(input: SetPluginBypassInput): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('set_plugin_bypass', input);
}
