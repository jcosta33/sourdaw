import { FERMENTER_DSP_PARAM_OVERRIDES } from '../../models/FermenterDspParam';

type MapFermenterParamToDspParamInput = {
    paramId: string;
};

function camelToSnake(paramId: string): string {
    return paramId.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function mapFermenterParamToDspParam(input: MapFermenterParamToDspParamInput): string {
    const override = FERMENTER_DSP_PARAM_OVERRIDES[input.paramId];
    if (override) {
        return override;
    }

    return camelToSnake(input.paramId);
}
