import { midiStore, type MidiStoreState } from '../../stores/midiStore';

import { midiTimeStateCodec } from './midiTimeStateCodec';

type PreparedRestoreState = {
    capturedState: MidiStoreState;
    capturedValueSnapshot: MidiStoreState;
    replacementState: MidiStoreState;
    replacementValueSnapshot: MidiStoreState;
    hasChanges: boolean;
};

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

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

    const validatedPlan = midiTimeStateCodec.decodeRestorePlan(plan);
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
