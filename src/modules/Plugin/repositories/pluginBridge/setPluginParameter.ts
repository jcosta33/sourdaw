import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

type SetPluginParameterInput = {
    instanceId: string;
    paramId: number;
    value: number;
};

export async function setPluginParameter(input: SetPluginParameterInput): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_plugin_parameter', input);
}
