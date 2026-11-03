import { valuesEqual } from '#/utils/structuralEquality';
import {
    decodeTempoMapRowPlan,
    type TempoMapEdit,
    type TempoMapRow,
    type TempoMapRowPlan,
} from '#/utils/tempoMapRowPlan';

import { MAX_TEMPO_MAP_TEMPO, MIN_TEMPO_MAP_TEMPO } from '../../models/TempoMap';
import { findTempoMapAddTarget } from '../../models/TempoMapAddTarget';

import { applyTempoMapRowPlan } from './applyTempoMapRowPlan';
import { timelineMapTimeStateCodec } from './timelineMapTimeStateCodec';

type Result = { readonly status: 'ready'; readonly plan: TempoMapRowPlan } | { readonly status: 'no-op' | 'rejected' };

type EditRows = {
    before: readonly TempoMapRow[];
    after: readonly TempoMapRow[];
    next: readonly TempoMapRow[];
    collision?: TempoMapRowPlan['collision'];
};
function prepareReplacement(
    input: Input,
    changes: readonly TempoMapRow[],
    edit: Extract<TempoMapEdit, { type: 'replace' }>
): EditRows | Result {
    if (
        edit.changes.some(
            (row) =>
                !Number.isFinite(row.beat) ||
                row.beat < 0 ||
                !Number.isFinite(row.tempo) ||
                row.tempo < MIN_TEMPO_MAP_TEMPO ||
                row.tempo > MAX_TEMPO_MAP_TEMPO ||
                (row.curve !== 'instant' && row.curve !== 'linear')
        ) ||
        (edit.changes.length > 0 && !input.createRow)
    ) {
        return { status: 'rejected' };
    }
    const before = changes;
    const after = edit.changes.map((row) => input.createRow!(row.beat, row.tempo, row.curve));
    if (
        after.some((row, index) => {
            const requested = edit.changes[index]!;
            return !valuesEqual(
                { beat: row.beat, tempo: row.tempo, curve: row.curve },
                { beat: requested.beat, tempo: requested.tempo, curve: requested.curve }
            );
        })
    ) {
        return { status: 'rejected' };
    }
    return { before, after, next: after };
}

function prepareEditedRows(input: Input, changes: readonly TempoMapRow[]): EditRows | Result {
    const { edit } = input;
    let before: readonly TempoMapRow[];
    let after: readonly TempoMapRow[];
    let next: readonly TempoMapRow[];
    let collision: TempoMapRowPlan['collision'];
    if (edit.type === 'replace') {
        return prepareReplacement(input, changes, edit);
    } else if (edit.type === 'add') {
        if (!Number.isFinite(edit.beat) || edit.beat < 0 || !Number.isFinite(edit.tempo)) {
            return { status: 'rejected' };
        }
        const existing = findTempoMapAddTarget(changes, edit.beat);
        collision = { beat: edit.beat, targetId: existing?.id ?? null };
        if (existing) {
            before = [existing];
            after = [{ ...existing, tempo: edit.tempo, curve: edit.curve ?? 'instant' }];
            next = changes.map((row) => (row.id === existing.id ? after[0]! : row));
        } else {
            if (!input.createRow) {
                return { status: 'rejected' };
            }
            before = [];
            after = [input.createRow(edit.beat, edit.tempo, edit.curve ?? 'instant')];
            if (
                !valuesEqual(
                    { beat: after[0]!.beat, tempo: after[0]!.tempo, curve: after[0]!.curve },
                    {
                        beat: edit.beat,
                        tempo: Math.max(MIN_TEMPO_MAP_TEMPO, Math.min(MAX_TEMPO_MAP_TEMPO, edit.tempo)),
                        curve: edit.curve ?? 'instant',
                    }
                )
            ) {
                return { status: 'rejected' };
            }
            next = [...changes, ...after].sort((left, right) => left.beat - right.beat);
        }
    } else {
        if (edit.id.length === 0) {
            return { status: 'rejected' };
        }
        const existing = changes.find((row) => row.id === edit.id);
        if (!existing) {
            return { status: 'no-op' };
        }
        before = [existing];
        if (edit.type === 'remove') {
            after = [];
            next = changes.filter((row) => row.id !== edit.id);
        } else {
            if (!Number.isFinite(edit.tempo)) {
                return { status: 'rejected' };
            }
            after = [{ ...existing, tempo: Math.max(MIN_TEMPO_MAP_TEMPO, Math.min(MAX_TEMPO_MAP_TEMPO, edit.tempo)) }];
            next = changes.map((row) => (row.id === edit.id ? after[0]! : row));
        }
    }
    return { before, after, next, collision };
}

/** Prepare immutable row ownership without publishing stores. The application
 * supplies its existing row producer once; replay consumes only captured ids. */
type Input = {
    readonly changes: readonly TempoMapRow[] | null;
    readonly edit: TempoMapEdit;
    readonly createRow?: (beat: number, tempo: number, curve: TempoMapRow['curve']) => TempoMapRow;
};

export function planTempoMapEdit(input: Input): Result {
    const { edit } = input;
    if (!input.changes && edit.type !== 'replace') {
        return { status: 'no-op' };
    }
    const changes = input.changes ?? [];
    if (
        new Set(changes.map((row) => row.id)).size !== changes.length ||
        !timelineMapTimeStateCodec.encodeState({
            tempoState: { changes: [...changes] },
            timeSignatureState: { changes: [] },
        })
    ) {
        return { status: 'rejected' };
    }
    const edited = prepareEditedRows(input, changes);
    if ('status' in edited) {
        return edited;
    }
    const { before, after, next, collision } = edited;
    if (valuesEqual(before, after)) {
        return { status: 'no-op' };
    }
    const beforeIds = new Set(before.map((row) => row.id));
    const afterIds = new Set(after.map((row) => row.id));
    const beats = new Set(
        [...before, ...after].filter((row) => beforeIds.has(row.id) !== afterIds.has(row.id)).map((row) => row.beat)
    );
    const planInput: Record<string, unknown> = {
        operation: edit.type,
        before,
        after,
        order: Array.from(beats, (beat) => ({
            beat,
            before: changes.filter((row) => row.beat === beat).map((row) => row.id),
            after: next.filter((row) => row.beat === beat).map((row) => row.id),
        })),
    };
    if (collision) {
        planInput.collision = collision;
    }
    const plan = decodeTempoMapRowPlan(planInput);
    if (!plan) {
        return { status: 'rejected' };
    }
    const applied = applyTempoMapRowPlan({ changes, plan });
    return applied && valuesEqual(applied, next) ? { status: 'ready', plan } : { status: 'rejected' };
}
