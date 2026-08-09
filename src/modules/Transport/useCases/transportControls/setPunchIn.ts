import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { createPunchRegionPatch } from './punchRegion';

export function setPunchIn(beat: number): boolean {
    const state = getTransportState();
    if (!state) {
        return false;
    }

    const patch = createPunchRegionPatch({ current: state, beat, edge: 'in' });
    if (patch === null) {
        return false;
    }

    updateTransportState(patch);
    return true;
}
