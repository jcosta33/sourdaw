import { observeTempoMapRowPlan, type TempoMapRow, type TempoMapRowClockWitness } from '#/utils/tempoMapRowPlan';

import { BEAT_EPSILON } from './TempoMap';

/** The owning row precondition shared by preparation and raw publication. */
export function tempoMapRowPlanMatchesCurrent(
    changes: readonly TempoMapRow[],
    witness: TempoMapRowClockWitness
): boolean {
    if (observeTempoMapRowPlan({ tempoMap: { changes } }, witness) !== 'from') {
        return false;
    }
    if (witness.direction === 'apply' && witness.plan.collision) {
        const { beat, targetId } = witness.plan.collision;
        const collision = changes.findLast((row) => Math.abs(row.beat - beat) <= BEAT_EPSILON);
        return (collision?.id ?? null) === targetId;
    }
    return true;
}
