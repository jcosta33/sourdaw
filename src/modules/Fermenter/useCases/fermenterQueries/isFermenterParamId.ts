import { FERMENTER_PARAMS } from './FERMENTER_PARAMS';

import type { FermenterPatch } from '../../models/FermenterPatch';

const FERMENTER_PARAM_IDS = new Set(FERMENTER_PARAMS.map((param) => param.id));

export function isFermenterParamId(paramId: string): paramId is keyof FermenterPatch {
    return FERMENTER_PARAM_IDS.has(paramId);
}
