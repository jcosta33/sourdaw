import { automationStore, type AutomationStoreState } from '../../stores/automationStore';

import { automationTimeStateCodec } from './automationTimeStateCodec';

type TransactionPhase = 'prepared' | 'applied' | 'closed';

type PreparedRestoreState = {
    capturedState: AutomationStoreState;
    expectedValueSnapshot: AutomationStoreState;
    replacementState: AutomationStoreState;
    replacementValueSnapshot: AutomationStoreState;
    hasChanges: boolean;
};

function prepareRestoreStateUnchecked(
    plan: unknown,
    currentState: AutomationStoreState | null
): PreparedRestoreState | null {
    const validatedPlan = automationTimeStateCodec.decodeRestorePlan(plan);
    if (!validatedPlan || !currentState) {
        return null;
    }

    const validatedCurrentState = automationTimeStateCodec.decodeState(currentState);
    if (
        !validatedCurrentState ||
        !automationTimeStateCodec.statesEqual(validatedCurrentState, validatedPlan.expected)
    ) {
        return null;
    }

    const expectedValueSnapshot = structuredClone(validatedPlan.expected);
    const replacementValueSnapshot = structuredClone(validatedPlan.replacement);
    if (
        !automationTimeStateCodec.statesEqual(validatedCurrentState, expectedValueSnapshot) ||
        !automationTimeStateCodec.statesEqual(validatedPlan.replacement, replacementValueSnapshot)
    ) {
        return null;
    }

    return {
        capturedState: validatedCurrentState,
        expectedValueSnapshot,
        replacementState: validatedPlan.replacement,
        replacementValueSnapshot,
        hasChanges: !automationTimeStateCodec.statesEqual(expectedValueSnapshot, replacementValueSnapshot),
    };
}

function prepareRestoreState(plan: unknown, currentState: AutomationStoreState | null): PreparedRestoreState | null {
    try {
        return prepareRestoreStateUnchecked(plan, currentState);
    } catch {
        return null;
    }
}

function matchesStateReferenceAndValue(
    currentState: AutomationStoreState | null,
    expectedReference: AutomationStoreState,
    expectedValueSnapshot: AutomationStoreState
): boolean {
    if (currentState !== expectedReference) {
        return false;
    }

    return automationTimeStateCodec.statesEqual(currentState, expectedValueSnapshot);
}

export function prepareAutomationTimeStateRestore(plan: unknown) {
    const currentState = automationStore.value;
    const preparedRestore = prepareRestoreState(plan, currentState);
    let status: 'ready' | 'rejected' = 'rejected';
    let hasChanges = false;
    let phase: TransactionPhase = 'closed';
    if (preparedRestore) {
        status = 'ready';
        hasChanges = preparedRestore.hasChanges;
        if (preparedRestore.hasChanges) {
            phase = 'prepared';
        }
    }

    function apply(): boolean {
        if (phase !== 'prepared' || !preparedRestore || !preparedRestore.hasChanges) {
            return false;
        }
        const { capturedState, expectedValueSnapshot, replacementState, replacementValueSnapshot } = preparedRestore;
        if (!matchesStateReferenceAndValue(automationStore.value, capturedState, expectedValueSnapshot)) {
            phase = 'closed';
            return false;
        }
        if (!automationTimeStateCodec.statesEqual(replacementState, replacementValueSnapshot)) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        automationStore.set(replacementState);
        if (!matchesStateReferenceAndValue(automationStore.value, replacementState, replacementValueSnapshot)) {
            return false;
        }

        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase !== 'applied' || !preparedRestore || !preparedRestore.hasChanges) {
            return false;
        }
        const { capturedState, expectedValueSnapshot, replacementState, replacementValueSnapshot } = preparedRestore;
        if (!matchesStateReferenceAndValue(automationStore.value, replacementState, replacementValueSnapshot)) {
            phase = 'closed';
            return false;
        }
        if (!automationTimeStateCodec.statesEqual(capturedState, expectedValueSnapshot)) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        automationStore.set(capturedState);
        return matchesStateReferenceAndValue(automationStore.value, capturedState, expectedValueSnapshot);
    }

    return {
        status,
        hasChanges,
        apply,
        revert,
    };
}
