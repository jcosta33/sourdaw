import { valuesEqual } from '#/utils/structuralEquality';
import { decodeTempoMapRowPlan, type TempoMapRow } from '#/utils/tempoMapRowPlan';

import { BEAT_EPSILON } from '../../models/TempoMap';

import { timelineMapTimeStateCodec } from './timelineMapTimeStateCodec';

/** Change only captured rows. Equal-beat order is audible; ordering between
 * different beats is not inverse authority over later peer rows. */
export function applyTempoMapRowPlan(input: {
    readonly changes: readonly TempoMapRow[];
    readonly plan: unknown;
    readonly direction?: 'apply' | 'restore';
}): TempoMapRow[] | null {
    const plan = decodeTempoMapRowPlan(input.plan);
    if (!plan) {
        return null;
    }
    // Reuse the owner's exact semantic round trip, including its bounds and
    // sanitizer. Neutral shape validation cannot authorize normalized rows.
    for (const rows of [input.changes, plan.before, plan.after]) {
        if (
            new Set(rows.map((row) => row.id)).size !== rows.length ||
            !timelineMapTimeStateCodec.encodeState({
                tempoState: { changes: [...rows] },
                timeSignatureState: { changes: [] },
            })
        ) {
            return null;
        }
    }
    const direction = input.direction ?? 'apply';
    const from = direction === 'apply' ? plan.before : plan.after;
    const to = direction === 'apply' ? plan.after : plan.before;
    const current = new Map(input.changes.map((row) => [row.id, row]));
    const fromIds = new Set(from.map((row) => row.id));
    const toById = new Map(to.map((row) => [row.id, row]));
    if (
        from.some((row) => !valuesEqual(current.get(row.id), row)) ||
        to.some((row) => !fromIds.has(row.id) && current.has(row.id))
    ) {
        return null;
    }
    if (direction === 'apply' && plan.collision) {
        const { beat, targetId } = plan.collision;
        const collision = input.changes.findLast((row) => Math.abs(row.beat - beat) <= BEAT_EPSILON);
        if ((collision?.id ?? null) !== targetId) {
            return null;
        }
    }
    const fromSide = direction === 'apply' ? 'before' : 'after';
    const toSide = direction === 'apply' ? 'after' : 'before';
    if (
        plan.order.some(
            (group) =>
                !valuesEqual(
                    input.changes.filter((row) => row.beat === group.beat).map((row) => row.id),
                    group[fromSide]
                )
        )
    ) {
        return null;
    }

    let result: TempoMapRow[];
    if (plan.operation === 'replace') {
        result = [...to, ...input.changes.filter((row) => !fromIds.has(row.id))];
    } else {
        result = input.changes.flatMap((row) => {
            if (!fromIds.has(row.id)) {
                return [row];
            }
            const replacement = toById.get(row.id);
            return replacement ? [replacement] : [];
        });
        result.push(...to.filter((row) => !fromIds.has(row.id)));
    }
    for (const group of plan.order) {
        const ordered = group[toSide].map((id) => result.find((row) => row.id === id)!);
        let index = 0;
        result = result.map((row) => (row.beat === group.beat ? ordered[index++]! : row));
    }
    if (plan.operation === 'add' && direction === 'apply' && plan.before.length === 0) {
        result.sort((left, right) => left.beat - right.beat);
    }
    return structuredClone(result);
}
