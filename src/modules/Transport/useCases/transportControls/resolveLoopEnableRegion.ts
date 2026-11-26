import { type TransportState } from '../../models/TransportState';

import { resolveNextLoopRegion } from './resolveNextLoopRegion';

export type LoopEnableRegion = Pick<TransportState, 'loopStart' | 'loopEnd'>;

/**
 * The region enabling the loop must set first: the current one cannot loop
 * (an unset zero-length region), so the loop-toggle law substitutes the span
 * of the arrangement or its first bar. `null` when the loop is already on,
 * the current region can loop, or no region can be found.
 */
export function resolveLoopEnableRegion(state: TransportState | null): LoopEnableRegion | null {
    if (!state || state.isLooping) {
        return null;
    }
    const next = resolveNextLoopRegion(state);
    if (!next || (next.loopStart === state.loopStart && next.loopEnd === state.loopEnd)) {
        return null;
    }
    return { loopStart: next.loopStart, loopEnd: next.loopEnd };
}
