import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

type SetPluginParameterInput = {
    instanceId: string;
    paramId: number;
    value: number;
};

export async function setPluginParameter(input: SetPluginParameterInput): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('set_plugin_parameter', input);
}
