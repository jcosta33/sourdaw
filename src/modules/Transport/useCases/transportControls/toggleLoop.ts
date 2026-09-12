import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { resolveNextLoopRegion } from './resolveNextLoopRegion';

export function toggleLoop(): boolean {
    const next = resolveNextLoopRegion(getTransportState());
    if (!next) {
        return false;
    }

    updateTransportState(next);
    return true;
}
