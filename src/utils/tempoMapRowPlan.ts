import { isRecord, valuesEqual } from './structuralEquality';

export type TempoMapRow = {
    readonly id: string;
    readonly beat: number;
    readonly tempo: number;
    readonly curve: 'instant' | 'linear';
};

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

function exactData(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
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

/** Shape and paired-row coherence only. Transport must also admit exact rows
 * against its own bounds; a normalizable row is not an exact saved value. */
export function decodeTempoMapRowPlan(value: unknown): TempoMapRowPlan | null {
    const keys = ['operation', 'before', 'after', 'order'];
    if (isRecord(value) && Object.hasOwn(value, 'collision')) {
        keys.push('collision');
    }
    if (
        !exactData(value, keys) ||
        (value.operation !== 'add' &&
            value.operation !== 'update' &&
            value.operation !== 'remove' &&
            value.operation !== 'replace') ||
        !denseArray(value.before) ||
        !value.before.every(readRow) ||
        !denseArray(value.after) ||
        !value.after.every(readRow) ||
        value.before.length + value.after.length === 0 ||
        valuesEqual(value.before, value.after) ||
        !uniqueIds(value.before.map((row) => row.id)) ||
        !uniqueIds(value.after.map((row) => row.id)) ||
        !denseArray(value.order) ||
        !value.order.every(readOrder)
    ) {
        return null;
    }
    let collision: TempoMapRowPlan['collision'];
    if (value.operation === 'add') {
        if (
            !exactData(value.collision, ['beat', 'targetId']) ||
            !validBeat(value.collision.beat) ||
            !(value.collision.targetId === null || validId(value.collision.targetId))
        ) {
            return null;
        }
        collision = { beat: value.collision.beat, targetId: value.collision.targetId };
    } else if (Object.hasOwn(value, 'collision')) {
        return null;
    }
    const plan: TempoMapRowPlan = {
        operation: value.operation,
        before: value.before,
        after: value.after,
        order: value.order,
        ...(collision ? { collision } : {}),
    };
    return coherentOperation(plan) && coherentOrder(plan) ? structuredClone(plan) : null;
}
