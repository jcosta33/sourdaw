import { mapFermenterParamToDspParam } from './mapFermenterParamToDspParam';

type MapFermenterPatchToDspPatchInput = {
    patch: Record<string, unknown>;
};

type MapFermenterPatchToDspPatchOutput = Record<string, number>;

export function mapFermenterPatchToDspPatch(input: MapFermenterPatchToDspPatchInput): MapFermenterPatchToDspPatchOutput {
    const dsp_patch: Record<string, number> = {};

    for (const [key, value] of Object.entries(input.patch)) {
        if (typeof value !== 'number') {
            continue;
        }

        dsp_patch[mapFermenterParamToDspParam({ paramId: key })] = value;
    }

    return dsp_patch;
}
