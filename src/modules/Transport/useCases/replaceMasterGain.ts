import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { MAX_MASTER_GAIN } from '../stores/transportStore';

type ReplaceMasterGainInput = {
    expectedPercent: number;
    replacementPercent: number;
};

/**
 * The guarded write's own range check, bounded by the field's real ceiling.
 *
 * `masterGain` is a 0–100 scale where 100 is unity, and the ceiling is
 * `MAX_MASTER_GAIN` — `100 * FADER_MAX_GAIN`, the master fader's `+6 dB` of
 * headroom on that scale — not 100. Bounding this at the literal `100`
 * silently no-wrote every action-sourced write above unity, which is the
 * whole path `handleSetMasterGain` routes through, and then refused the undo
 * as well: once the fader sat above 100 the inverse action's own
 * `expectedPercent` was out of interval too, so the master fader became a
 * one-way trip.
 */
function isPercentInterval(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= MAX_MASTER_GAIN;
}

export function replaceMasterGain({ expectedPercent, replacementPercent }: ReplaceMasterGainInput): boolean {
    if (!isPercentInterval(expectedPercent) || !isPercentInterval(replacementPercent)) {
        return false;
    }
    const state = getTransportState();
    if (!state || state.masterGain !== expectedPercent || state.masterGain === replacementPercent) {
        return false;
    }
    updateTransportState({ masterGain: replacementPercent });
    return true;
}
