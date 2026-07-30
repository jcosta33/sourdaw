import { FERMENTER_DSP_PARAM_OVERRIDES } from '../../models/FermenterDspParam';

type MapFermenterParamToDspParamInput = {
    paramId: string;
};

const dspParamIdCache = new Map<string, string>();

function camelToSnake(paramId: string): string {
    return paramId.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function mapFermenterParamToDspParam(input: MapFermenterParamToDspParamInput): string {
    const cached = dspParamIdCache.get(input.paramId);
    if (cached) {
        return cached;
    }

    const override = FERMENTER_DSP_PARAM_OVERRIDES[input.paramId];
    const mapped = override ?? camelToSnake(input.paramId);
    dspParamIdCache.set(input.paramId, mapped);
    return mapped;
}
