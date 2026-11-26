import { MAX_TRANSPORT_BARS, MIN_TRANSPORT_BARS } from '#/utils/transportBarsLimits';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

type SetCountInBarsResult = {
    status: 'written' | 'no-write' | 'conflict';
};

/** `expectedBars`, when given, makes the write conditional on the bar count a restore expects to replace. */
export function setCountInBars(bars: number, expectedBars?: number): SetCountInBarsResult {
    const state = getTransportState();
    const clamped = Math.max(MIN_TRANSPORT_BARS, Math.min(MAX_TRANSPORT_BARS, bars));
    if (!state) {
        return { status: 'no-write' };
    }
    if (expectedBars !== undefined && state.countInBars !== expectedBars) {
        return { status: 'conflict' };
    }
    updateTransportState({ countInBars: clamped });
    return { status: 'written' };
}
