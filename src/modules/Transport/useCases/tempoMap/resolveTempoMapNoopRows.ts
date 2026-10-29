import { type TempoMapEdit, type TempoMapRow } from '#/utils/tempoMapRowPlan';

import { BEAT_EPSILON } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';

import { planTempoMapEdit } from './planTempoMapEdit';

/** A no-op creates no plan; resolve only the rows the same public planner folded into. */
export function resolveTempoMapNoopRows(edit: TempoMapEdit): readonly TempoMapRow[] | null {
    const changes = tempoMapStore.value?.changes ?? null;
    if (!changes || planTempoMapEdit({ changes, edit }).status !== 'no-op') {
        return null;
    }
    if (edit.type === 'add') {
        const row = changes.findLast((candidate) => Math.abs(candidate.beat - edit.beat) <= BEAT_EPSILON);
        return row ? [structuredClone(row)] : null;
    }
    if (edit.type === 'update') {
        const row = changes.find((candidate) => candidate.id === edit.id);
        return row ? [structuredClone(row)] : [];
    }
    return [];
}
