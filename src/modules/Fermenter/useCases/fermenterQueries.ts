import { FERMENTER_PRESETS as repositoryFermenterPresets } from '../repositories/fermenterPresets';
import { FERMENTER_PARAMS as modelFermenterParams } from '../models/FermenterPatch';

export type FermenterParamDefinition = {
    id: string;
    label: string;
    min: number;
    max: number;
    default: number;
    unit: string;
    step?: number;
    group?: string;
    scaling?: 'log' | 'linear';
};

export function getFermenterPresets() {
    return repositoryFermenterPresets;
}

export const FERMENTER_PRESETS = repositoryFermenterPresets;

export const FERMENTER_PARAMS: readonly FermenterParamDefinition[] = modelFermenterParams.map((param) => ({
    ...param,
}));
