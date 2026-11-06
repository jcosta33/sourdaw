import { setPluginParameter as setPluginParameterRepo } from '../../repositories/pluginBridge/setPluginParameter';
import { patchExternalPluginParameterValue } from '../../stores/externalPluginParameterStore';

type SetPluginParameterInput = {
    instanceId: string;
    paramId: number;
    value: number;
};

type SetPluginParameterOutput = Promise<void>;

export async function setPluginParameter(input: SetPluginParameterInput): SetPluginParameterOutput {
    await setPluginParameterRepo(input);
    // The host's published view follows every write it accepted; a rejected write throws above and leaves it.
    patchExternalPluginParameterValue(input.instanceId, input.paramId, input.value);
}
