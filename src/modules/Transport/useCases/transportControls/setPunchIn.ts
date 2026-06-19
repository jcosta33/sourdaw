import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function setPunchIn(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    // The scheduler only arms/disarms punch recording while
    // `punchInBeat < punchOutBeat` (playheadScheduler `tick`). Without a
    // cross-check, an in-point set at or beyond the current out-point produces
    // an inverted region that silently disables punch. Clamp to the timeline
    // origin, and when the new in-point would meet or pass the out-point, push
    // the out-point out so a forward region is preserved.
    const punchInBeat = Math.max(0, beat);
    if (punchInBeat >= state.punchOutBeat) {
        updateTransportState({ punchInBeat, punchOutBeat: punchInBeat + 1 });
        return;
    }

    updateTransportState({ punchInBeat });
}
