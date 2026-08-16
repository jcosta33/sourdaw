import { setPluginBypass as setPluginBypassRepo } from '../../repositories/pluginBridge/setPluginBypass';

type SetPluginBypassInput = {
    instanceId: string;
    bypassed: boolean;
};

type SetPluginBypassOutput = Promise<void>;

export function setPluginBypass(input: SetPluginBypassInput): SetPluginBypassOutput {
    return setPluginBypassRepo(input);
}
