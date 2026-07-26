import { midiStore, type MidiStoreState } from '../../stores/midiStore';

import { midiTimeStateCodec } from './midiTimeStateCodec';

type MidiTimeStateRestorePlan = {
    version: 1;
    expected: MidiStoreState;
    replacement: MidiStoreState;
};

type PreparedRestoreState = {
    capturedState: MidiStoreState;
    capturedValueSnapshot: MidiStoreState;
    replacementState: MidiStoreState;
    replacementValueSnapshot: MidiStoreState;
    hasChanges: boolean;
};

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

function readDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) {
        return null;
    }

    const expectedKeySet = new Set(expectedKeys);
    const properties: Record<string, unknown> = {};
    for (const ownKey of ownKeys) {
        if (typeof ownKey !== 'string' || !expectedKeySet.has(ownKey)) {
            return null;
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        Object.defineProperty(properties, ownKey, {
            configurable: true,
            enumerable: true,
            value: descriptor.value,
            writable: true,
        });
    }

    return properties;
}

function validateRestorePlanUnchecked(value: unknown): MidiTimeStateRestorePlan | null {
    const properties = readDataObject(value, ['version', 'expected', 'replacement']);
    if (!properties || properties.version !== 1) {
        return null;
    }

    const expected = midiTimeStateCodec.decodeState(properties.expected);
    const replacement = midiTimeStateCodec.decodeState(properties.replacement);
    if (!expected || !replacement) {
        return null;
    }

    return {
        version: 1,
        expected,
        replacement,
    };
}

function cloneValidatedState(state: MidiStoreState): MidiStoreState | null {
    const encodedState = midiTimeStateCodec.encodeState(state);
    if (!encodedState) {
        return null;
    }

    return midiTimeStateCodec.decodeState(encodedState);
}

function prepareRestoreStateUnchecked(plan: unknown, currentState: MidiStoreState | null): PreparedRestoreState | null {
    if (!currentState) {
        return null;
    }

    const validatedPlan = validateRestorePlanUnchecked(plan);
    if (!validatedPlan || !midiTimeStateCodec.statesEqual(currentState, validatedPlan.expected)) {
        return null;
    }

    const replacementValueSnapshot = cloneValidatedState(validatedPlan.replacement);
    if (!replacementValueSnapshot) {
        return null;
    }

    return {
        capturedState: currentState,
        capturedValueSnapshot: validatedPlan.expected,
        replacementState: validatedPlan.replacement,
        replacementValueSnapshot,
        hasChanges: !midiTimeStateCodec.statesEqual(validatedPlan.expected, validatedPlan.replacement),
    };
}

function prepareRestoreState(plan: unknown, currentState: MidiStoreState | null): PreparedRestoreState | null {
    try {
        return prepareRestoreStateUnchecked(plan, currentState);
    } catch {
        return null;
    }
}

function matchesReferenceAndValue(
    currentState: MidiStoreState | null,
    expectedReference: MidiStoreState,
    expectedValueSnapshot: MidiStoreState
): boolean {
    if (currentState !== expectedReference) {
        return false;
    }

    return midiTimeStateCodec.statesEqual(currentState, expectedValueSnapshot);
}

function isPublishingPhase(phase: TransactionPhase): boolean {
    return phase === 'publishing';
}

export function prepareMidiTimeStateRestore(plan: unknown) {
    const currentState = midiStore.value;
    const preparedRestore = prepareRestoreState(plan, currentState);
    let status: 'ready' | 'rejected' = 'rejected';
    let hasChanges = false;
    let phase: TransactionPhase = 'closed';
    if (preparedRestore) {
        status = 'ready';
        hasChanges = preparedRestore.hasChanges;
        if (hasChanges) {
            phase = 'prepared';
        }
    }

    function apply(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'prepared' || !preparedRestore || !preparedRestore.hasChanges) {
            phase = 'closed';
            return false;
        }

        const { capturedState, capturedValueSnapshot, replacementState, replacementValueSnapshot } = preparedRestore;
        if (!matchesReferenceAndValue(midiStore.value, capturedState, capturedValueSnapshot)) {
            phase = 'closed';
            return false;
        }
        if (!midiTimeStateCodec.statesEqual(replacementState, replacementValueSnapshot)) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            midiStore.set(replacementState);
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!isPublishingPhase(phase)) {
            phase = 'closed';
            return false;
        }
        if (!matchesReferenceAndValue(midiStore.value, replacementState, replacementValueSnapshot)) {
            phase = 'closed';
            return false;
        }

        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'applied' || !preparedRestore || !preparedRestore.hasChanges) {
            phase = 'closed';
            return false;
        }

        const { capturedState, capturedValueSnapshot, replacementState, replacementValueSnapshot } = preparedRestore;
        if (!matchesReferenceAndValue(midiStore.value, replacementState, replacementValueSnapshot)) {
            phase = 'closed';
            return false;
        }
        if (!midiTimeStateCodec.statesEqual(capturedState, capturedValueSnapshot)) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            midiStore.set(capturedState);
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!isPublishingPhase(phase)) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        return matchesReferenceAndValue(midiStore.value, capturedState, capturedValueSnapshot);
    }

    return {
        status,
        hasChanges,
        apply,
        revert,
    };
}
