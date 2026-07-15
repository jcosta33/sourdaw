import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { createPunchRegionPatch } from './punchRegion';

export function setPunchOut(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    const patch = createPunchRegionPatch({ current: state, beat, edge: 'out' });
    if (patch === null) {
        return;
    }

    updateTransportState(patch);
}
