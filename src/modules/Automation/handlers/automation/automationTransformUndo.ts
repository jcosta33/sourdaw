import { type HandlerDescribeResult } from '#/modules/Command/useCases';

import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

/**
 * Shared `describe()` body for the automation transform handlers
 * (reverse/scale/stretch/thin/quantize/invert). Each of these mutates one lane's
 * `points` in place; their lossless inverse is to restore the lane's points to a
 * pre-execute snapshot.
 *
 * Runs PRE-execute (see executeAppAction), so it reads the lane's current points
 * before the transform changes them, deep-copies them (so a later CRDT/store
 * mutation cannot alias the snapshot), and emits a `restoreAutomationLanePoints`
 * inverse carrying that snapshot. When the lane is missing — execute will be a
 * no-op — the inverse is omitted rather than emitted lossy.
 */
export function describeLaneTransformUndo(laneId: string, label: string): HandlerDescribeResult {
    const state = getAutomationStoreState();
    const lane = state?.lanes.find((candidate) => candidate.id === laneId);
    if (!lane) {
        return { label };
    }
    const points = lane.points.map((point) => ({ ...point }));
    return {
        label,
        inverseAction: {
            type: 'restoreAutomationLanePoints',
            payload: { laneId, points },
        },
    };
}
