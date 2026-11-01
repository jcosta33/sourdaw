import { type TempoMapRow } from '#/utils/tempoMapRowPlan';

import { BEAT_EPSILON } from './TempoMap';

/** Input order decides which arrival/head row an add at a colliding beat edits. */
export function findTempoMapAddTarget(changes: readonly TempoMapRow[], beat: number): TempoMapRow | undefined {
    return changes.findLast((row) => Math.abs(row.beat - beat) <= BEAT_EPSILON);
}
