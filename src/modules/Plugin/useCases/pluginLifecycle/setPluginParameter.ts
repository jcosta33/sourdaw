import { setPluginParameter as setPluginParameterRepo } from '../../repositories/pluginBridge/setPluginParameter';

type SetPluginParameterInput = {
    instanceId: string;
    paramId: number;
    value: number;
};

type SetPluginParameterOutput = Promise<void>;

export function setPluginParameter(input: SetPluginParameterInput): SetPluginParameterOutput {
    return setPluginParameterRepo(input);
}
