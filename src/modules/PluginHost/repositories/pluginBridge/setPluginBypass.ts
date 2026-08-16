import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

type SetPluginBypassInput = {
    instanceId: string;
    bypassed: boolean;
};

export async function setPluginBypass(input: SetPluginBypassInput): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_plugin_bypass', input);
}
