import { type TempoMapEdit, type TempoMapRow } from '#/utils/tempoMapRowPlan';

import { findTempoMapAddTarget } from '../models/TempoMapAddTarget';

import { tempoMapStore } from './tempoMapStore';

/** Read targets only; callers retain the owning planner's admission in the same synchronous phase. */
export function readTempoMapEditTargets(edit: TempoMapEdit): readonly TempoMapRow[] | null {
    const changes = tempoMapStore.value?.changes;
    if (!changes) {
        return null;
    }
    if (edit.type === 'add') {
        const row = findTempoMapAddTarget(changes, edit.beat);
        return row ? [structuredClone(row)] : null;
    }
    if (edit.type === 'update') {
        const row = changes.find((candidate) => candidate.id === edit.id);
        return row ? [structuredClone(row)] : [];
    }
    return [];
}
