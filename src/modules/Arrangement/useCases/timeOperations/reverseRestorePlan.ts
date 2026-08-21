import { timeOperationStateCodec } from './timeOperationStateCodec';

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

/**
 * Turns a restore plan into the plan that restores the state the original plan reverted
 * from. Redo for a global time operation replays this rather than the forward operation:
 * re-running `deleteTime` would delete a *second* range instead of reinstating the one the
 * original run removed.
 */
export function reverseRestorePlan(value: unknown): unknown {
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
