import { MAX_TRANSPORT_BARS, MIN_TRANSPORT_BARS } from '#/utils/transportBarsLimits';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

type SetPreRollBarsResult = {
    status: 'written' | 'no-write' | 'conflict';
};

/** `expectedBars`, when given, makes the write conditional on the bar count a restore expects to replace. */
export function setPreRollBars(bars: number, expectedBars?: number): SetPreRollBarsResult {
    const state = getTransportState();
    const clamped = Math.max(MIN_TRANSPORT_BARS, Math.min(MAX_TRANSPORT_BARS, bars));
    if (!state) {
        return { status: 'no-write' };
    }
    if (expectedBars !== undefined && state.preRollBars !== expectedBars) {
        return { status: 'conflict' };
    }
    updateTransportState({ preRollBars: clamped });
    return { status: 'written' };
}
