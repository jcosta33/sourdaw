import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function setPunchOut(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    // The scheduler only arms/disarms punch recording while
    // `punchInBeat < punchOutBeat` (playheadScheduler `tick`). Without a
    // cross-check, an out-point set at or below the current in-point produces
    // an inverted region that silently disables punch. Clamp to the timeline
    // origin, and when the new out-point would meet or fall behind the
    // in-point, pull the in-point back so a forward region is preserved.
    const punchOutBeat = Math.max(0, beat);
    if (punchOutBeat <= state.punchInBeat) {
        updateTransportState({ punchOutBeat, punchInBeat: Math.max(0, punchOutBeat - 1) });
        return;
    }

    updateTransportState({ punchOutBeat });
}
