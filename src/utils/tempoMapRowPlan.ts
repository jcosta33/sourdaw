import { isRecord, valuesEqual } from './structuralEquality';

export type TempoMapRow = {
    readonly id: string;
    readonly beat: number;
    readonly tempo: number;
    readonly curve: 'instant' | 'linear';
};

export type TempoMapEdit =
    | { readonly type: 'add'; readonly beat: number; readonly tempo: number; readonly curve?: 'instant' | 'linear' }
    | { readonly type: 'update'; readonly id: string; readonly tempo: number }
    | { readonly type: 'remove'; readonly id: string }
    | { readonly type: 'replace'; readonly changes: readonly Omit<TempoMapRow, 'id'>[] };

export type TempoMapRowPlan = {
    readonly operation: 'add' | 'update' | 'remove' | 'replace';
    readonly before: readonly TempoMapRow[];
    readonly after: readonly TempoMapRow[];
    readonly order: readonly {
        readonly beat: number;
        readonly before: readonly string[];
        readonly after: readonly string[];
    }[];
    readonly collision?: { readonly beat: number; readonly targetId: string | null };
};

export type TempoMapRowClockWitness = {
    readonly plan: TempoMapRowPlan;
    readonly direction: 'apply' | 'restore';
};

/** Identify an owned clock observation, without changing rows or hiding peers.
 * The row writer independently authenticates FROM and EPS collisions. */
export function observeTempoMapRowPlan(
    context: { readonly tempoMap?: unknown },
    witness: TempoMapRowClockWitness
): 'from' | 'to' | null {
    const plan = decodeTempoMapRowPlan(witness.plan);
    if (!plan) {
        return null;
    }
    const changes = readTempoMapRows(context);
    if (!changes) {
        return null;
    }
    const ownedIds = new Set([...plan.before, ...plan.after].map((row) => row.id));
    const matches = (side: 'before' | 'after'): boolean => {
        const expected = plan[side];
        return (
            changes.filter((row) => ownedIds.has(row.id)).length === expected.length &&
            expected.every((row) =>
                valuesEqual(
                    changes.find((current) => current.id === row.id),
                    row
                )
            ) &&
            plan.order.every((group) =>
                valuesEqual(
                    changes.filter((row) => row.beat === group.beat).map((row) => row.id),
                    group[side]
                )
            )
        );
    };
    const from = witness.direction === 'apply' ? 'before' : 'after';
    const to = witness.direction === 'apply' ? 'after' : 'before';
    if (matches(from)) {
        return 'from';
    }
    return matches(to) ? 'to' : null;
}

/** Structural clock view only; Transport retains semantic bounds/admission. */
export function readTempoMapRows(context: { readonly tempoMap?: unknown }): TempoMapRow[] | null {
    let raw: unknown = [];
    if (context.tempoMap !== undefined) {
        if (!isRecord(context.tempoMap) || !Array.isArray(context.tempoMap.changes)) {
            return null;
        }
        raw = context.tempoMap.changes;
    }
    if (!Array.isArray(raw)) {
        return null;
    }
    const changes: TempoMapRow[] = [];
    for (const value of raw) {
        if (!isRecord(value) || Object.keys(value).length !== 4) {
            return null;
        }
        const row = { id: value.id, beat: value.beat, tempo: value.tempo, curve: value.curve };
        if (!readRow(row)) {
            return null;
        }
        changes.push(row);
    }
    if (new Set(changes.map((row) => row.id)).size !== changes.length) {
        return null;
    }
    return changes;
}

export function isTempoMapEdit(value: unknown): value is TempoMapEdit {
    if (!isRecord(value)) {
        return false;
    }
    if (value.type === 'remove') {
        return exactData(value, ['type', 'id']) && validId(value.id);
    }
    if (value.type === 'update') {
        return (
            exactData(value, ['type', 'id', 'tempo']) &&
            validId(value.id) &&
            typeof value.tempo === 'number' &&
            Number.isFinite(value.tempo)
        );
    }
    if (value.type === 'add') {
        const keys = ['type', 'beat', 'tempo'];
        if (Object.hasOwn(value, 'curve')) {
            keys.push('curve');
        }
        return (
            exactData(value, keys) &&
            validBeat(value.beat) &&
            typeof value.tempo === 'number' &&
            Number.isFinite(value.tempo) &&
            (value.curve === undefined || value.curve === 'instant' || value.curve === 'linear')
        );
    }
    return (
        value.type === 'replace' &&
        exactData(value, ['type', 'changes']) &&
        denseArray(value.changes) &&
        value.changes.every(
            (row) =>
                exactData(row, ['beat', 'tempo', 'curve']) &&
                validBeat(row.beat) &&
                typeof row.tempo === 'number' &&
                Number.isFinite(row.tempo) &&
                (row.curve === 'instant' || row.curve === 'linear')
        )
    );
}

function exactData(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!isRecord(value)) {
        return false;
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return false;
    }
    return (
        Reflect.ownKeys(value).length === keys.length &&
        keys.every((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
        })
    );
}

function denseArray(value: unknown): value is unknown[] {
    return (
        Array.isArray(value) &&
        Object.getPrototypeOf(value) === Array.prototype &&
        Reflect.ownKeys(value).length === value.length + 1 &&
        Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, index)).every(
            (descriptor) => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
        )
    );
}

function validId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function validBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readRow(value: unknown): value is TempoMapRow {
    return (
        exactData(value, ['id', 'beat', 'tempo', 'curve']) &&
        validId(value.id) &&
        validBeat(value.beat) &&
        typeof value.tempo === 'number' &&
        Number.isFinite(value.tempo) &&
        value.tempo > 0 &&
        (value.curve === 'instant' || value.curve === 'linear')
    );
}

function uniqueIds(value: unknown): value is string[] {
    return denseArray(value) && value.every(validId) && new Set(value).size === value.length;
}

function readOrder(value: unknown): value is TempoMapRowPlan['order'][number] {
    return (
        exactData(value, ['beat', 'before', 'after']) &&
        validBeat(value.beat) &&
        uniqueIds(value.before) &&
        uniqueIds(value.after)
    );
}

function coherentOperation(plan: TempoMapRowPlan): boolean {
    const before = plan.before[0];
    const after = plan.after[0];
    if (plan.operation === 'replace') {
        const ids = new Set(plan.before.map((row) => row.id));
        return plan.after.every((row) => !ids.has(row.id));
    }
    if (plan.operation === 'remove') {
        return plan.before.length === 1 && plan.after.length === 0;
    }
    if (plan.operation === 'add' && plan.collision?.targetId === null) {
        return plan.before.length === 0 && plan.after.length === 1;
    }
    if (!before || !after || plan.before.length !== 1 || plan.after.length !== 1) {
        return false;
    }
    if (before.id !== after.id || before.beat !== after.beat) {
        return false;
    }
    if (plan.operation === 'update') {
        return before.curve === after.curve;
    }
    return plan.collision?.targetId === before.id;
}

function coherentOrder(plan: TempoMapRowPlan): boolean {
    const before = new Map(plan.before.map((row) => [row.id, row]));
    const after = new Map(plan.after.map((row) => [row.id, row]));
    const changed = [...plan.before, ...plan.after].filter((row) => before.has(row.id) !== after.has(row.id));
    const beats = new Set(changed.map((row) => row.beat));
    if (plan.order.length !== beats.size || !plan.order.every((group) => beats.has(group.beat))) {
        return false;
    }
    if (new Set(plan.order.map((group) => group.beat)).size !== plan.order.length) {
        return false;
    }
    for (const group of plan.order) {
        for (const side of ['before', 'after'] as const) {
            const owned = side === 'before' ? before : after;
            const opposite = side === 'before' ? after : before;
            if (
                group[side].some((id) => {
                    const row = owned.get(id);
                    return row ? row.beat !== group.beat : opposite.has(id);
                }) ||
                [...owned.values()].some((row) => row.beat === group.beat && !group[side].includes(row.id))
            ) {
                return false;
            }
        }
        const untouchedBefore = group.before.filter((id) => !before.has(id));
        const untouchedAfter = group.after.filter((id) => !after.has(id));
        if (!valuesEqual(untouchedBefore, untouchedAfter)) {
            return false;
        }
    }
    return true;
}

function validCollision(value: unknown): value is { beat: number; targetId: string | null } {
    return (
        exactData(value, ['beat', 'targetId']) &&
        validBeat(value.beat) &&
        (value.targetId === null || validId(value.targetId))
    );
}

function validOperation(value: unknown): value is TempoMapRowPlan['operation'] {
    return value === 'add' || value === 'update' || value === 'remove' || value === 'replace';
}

function validRowChange(before: TempoMapRow[], after: TempoMapRow[]): boolean {
    return (
        before.length + after.length > 0 &&
        !valuesEqual(before, after) &&
        uniqueIds(before.map((row) => row.id)) &&
        uniqueIds(after.map((row) => row.id))
    );
}

/** Shape and paired-row coherence only. Transport must also admit exact rows
 * against its own bounds; a normalizable row is not an exact saved value. */
export function decodeTempoMapRowPlan(value: unknown): TempoMapRowPlan | null {
    const keys = ['operation', 'before', 'after', 'order'];
    if (isRecord(value) && Object.hasOwn(value, 'collision')) {
        keys.push('collision');
    }
    if (
        !exactData(value, keys) ||
        !validOperation(value.operation) ||
        !denseArray(value.before) ||
        !value.before.every(readRow) ||
        !denseArray(value.after) ||
        !value.after.every(readRow) ||
        !denseArray(value.order) ||
        !value.order.every(readOrder)
    ) {
        return null;
    }
    if (!validRowChange(value.before, value.after)) {
        return null;
    }
    let collision: TempoMapRowPlan['collision'];
    if (value.operation === 'add') {
        if (!validCollision(value.collision)) {
            return null;
        }
        collision = { beat: value.collision.beat, targetId: value.collision.targetId };
    } else if (Object.hasOwn(value, 'collision')) {
        return null;
    }
    let plan: TempoMapRowPlan = {
        operation: value.operation,
        before: value.before,
        after: value.after,
        order: value.order,
    };
    if (collision) {
        plan = { ...plan, collision };
    }
    return coherentOperation(plan) && coherentOrder(plan) ? structuredClone(plan) : null;
}
