import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { create_punch_region_patch } from './punchRegion';

export function setPunchOut(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    updateTransportState(create_punch_region_patch({ current: state, beat, edge: 'out' }));
}
