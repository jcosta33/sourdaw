import { prepareTimeOperationStateRestore } from './prepareTimeOperationStateRestore';
import { timeOperationStateCodec } from './timeOperationStateCodec';

import type { executeGlobalTimeOperation } from './executeGlobalTimeOperation';

type GlobalTimeOperationResult = ReturnType<typeof executeGlobalTimeOperation>;
type AppliedGlobalTimeOperationResult = Extract<GlobalTimeOperationResult, { status: 'applied' }>;
type CreateUndoableGlobalTimeOperationInput = {
    initialResult: AppliedGlobalTimeOperationResult;
};

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('Global time operation produced an invalid inverse');
    }
}

function swapTransition(value: Record<string, unknown>): Record<string, unknown> {
    return {
        ...value,
        expected: value.replacement,
        replacement: value.expected,
    };
}

/**
 * An owner slot holds either a plain `{version, expected, replacement}` plan or
 * — when the plan does not survive a canonical JSON round trip — the codec's
 * opaque node for one. Spreading an opaque node would swap two keys it does not
 * have, silently producing a plan with `expected: undefined` that every later
 * validation rejects, so the node is decoded, swapped, and re-encoded instead.
 */
function reverseTransition(value: unknown): unknown {
    if (value === null) {
        return null;
    }
    assertRecord(value);
    if (Object.hasOwn(value, 'expected') && Object.hasOwn(value, 'replacement')) {
        return swapTransition(value);
    }

    const decoded = timeOperationStateCodec.decodeOpaqueJsonPlan(value);
    if (!decoded || !Object.hasOwn(decoded, 'expected') || !Object.hasOwn(decoded, 'replacement')) {
        throw new TypeError('Global time operation produced an invalid inverse');
    }
    const encoded = timeOperationStateCodec.encodeOpaqueJsonPlan(swapTransition(decoded));
    if (!encoded) {
        throw new TypeError('Global time operation produced an invalid inverse');
    }
    return encoded;
}

function reverseRestorePlan(value: unknown): unknown {
    assertRecord(value);
    return {
        ...value,
        local: reverseTransition(value.local),
        automation: reverseTransition(value.automation),
        midi: reverseTransition(value.midi),
        timelineMap: reverseTransition(value.timelineMap),
        clipSatellites: reverseTransition(value.clipSatellites),
    };
}

function restoreOrThrow(plan: unknown, operation: 'undo' | 'redo'): void {
    const restoration = prepareTimeOperationStateRestore(plan);
    if (restoration.status !== 'ready') {
        throw new Error(`Global time operation ${operation} conflicts with current project state`);
    }
    if (!restoration.hasChanges) {
        throw new Error(`Global time operation ${operation} was not applied`);
    }
    if (!restoration.apply()) {
        throw new Error(`Global time operation ${operation} was not applied`);
    }
}

export function createUndoableGlobalTimeOperation({ initialResult }: CreateUndoableGlobalTimeOperationInput): {
    undo: () => void;
    redo: () => void;
} {
    const redoPlan = reverseRestorePlan(initialResult.inversePlan);

    return {
        undo: () => restoreOrThrow(initialResult.inversePlan, 'undo'),
        redo: () => restoreOrThrow(redoPlan, 'redo'),
    };
}
