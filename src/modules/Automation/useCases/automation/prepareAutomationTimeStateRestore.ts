import {
    automationStore,
    sanitize_automation_store_state,
    type AutomationStoreState,
} from '../../stores/automationStore';

type TransactionPhase = 'prepared' | 'applied' | 'closed';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    if (actualKeys.length !== expectedKeys.length) {
        return false;
    }

    for (const expectedKey of expectedKeys) {
        if (!Object.hasOwn(value, expectedKey)) {
            return false;
        }
    }

    return true;
}

function isPlainJsonArray(value: unknown[], ancestors: Set<object>): boolean {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Array.prototype) {
        return false;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
        return false;
    }

    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (
            !descriptor ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            !isPlainJsonValue(descriptor.value, ancestors)
        ) {
            return false;
        }
    }

    return true;
}

function isPlainJsonObject(value: Record<string, unknown>, ancestors: Set<object>): boolean {
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (ownKeys.length !== enumerableKeys.length) {
        return false;
    }

    for (const key of enumerableKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !isPlainJsonValue(descriptor.value, ancestors)) {
            return false;
        }
    }

    return true;
}

function isPlainJsonValue(value: unknown, ancestors: Set<object> = new Set<object>()): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (typeof value !== 'object') {
        return false;
    }
    if (ancestors.has(value)) {
        return false;
    }

    ancestors.add(value);
    let isValid = false;
    if (Array.isArray(value)) {
        isValid = isPlainJsonArray(value, ancestors);
    } else if (isPlainObject(value)) {
        isValid = isPlainJsonObject(value, ancestors);
    }
    ancestors.delete(value);

    return isValid;
}

function validateAutomationState(value: unknown): AutomationStoreState | null {
    if (!isPlainJsonValue(value)) {
        return null;
    }

    const sanitizedState = sanitize_automation_store_state(value);
    if (sanitizedState !== value) {
        return null;
    }

    return sanitizedState;
}

function areAutomationStateValuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }

        for (let index = 0; index < left.length; index += 1) {
            if (!areAutomationStateValuesEqual(left[index], right[index])) {
                return false;
            }
        }

        return true;
    }
    if (!isPlainObject(left) || !isPlainObject(right)) {
        return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }

    for (const key of leftKeys) {
        if (!Object.hasOwn(right, key) || !areAutomationStateValuesEqual(left[key], right[key])) {
            return false;
        }
    }

    return true;
}

type AutomationTimeStateRestorePlan = {
    version: 1;
    expected: AutomationStoreState;
    replacement: AutomationStoreState;
};

function validateRestorePlan(value: unknown): AutomationTimeStateRestorePlan | null {
    if (!isPlainJsonValue(value) || !isPlainObject(value)) {
        return null;
    }
    if (!hasExactKeys(value, ['version', 'expected', 'replacement'])) {
        return null;
    }
    if (value.version !== 1) {
        return null;
    }

    const expected = validateAutomationState(value.expected);
    const replacement = validateAutomationState(value.replacement);
    if (!expected || !replacement) {
        return null;
    }

    return {
        version: 1,
        expected,
        replacement,
    };
}

export function prepareAutomationTimeStateRestore(plan: unknown) {
    const currentState = automationStore.value;
    const validatedPlan = validateRestorePlan(plan);
    let capturedState: AutomationStoreState | null = null;
    let replacementState: AutomationStoreState | null = null;
    let status: 'ready' | 'rejected' = 'rejected';
    let hasChanges = false;
    let phase: TransactionPhase = 'closed';
    if (validatedPlan && currentState) {
        const validatedCurrentState = validateAutomationState(currentState);
        if (validatedCurrentState && areAutomationStateValuesEqual(validatedCurrentState, validatedPlan.expected)) {
            status = 'ready';

            if (!areAutomationStateValuesEqual(validatedPlan.expected, validatedPlan.replacement)) {
                capturedState = validatedCurrentState;
                replacementState = validatedPlan.replacement;
                hasChanges = true;
                phase = 'prepared';
            }
        }
    }

    function apply(): boolean {
        if (phase !== 'prepared' || !capturedState || !replacementState) {
            return false;
        }
        if (automationStore.value !== capturedState) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        automationStore.set(replacementState);
        if (automationStore.value !== replacementState) {
            return false;
        }

        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase !== 'applied' || !capturedState || !replacementState) {
            return false;
        }
        if (automationStore.value !== replacementState) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        automationStore.set(capturedState);
        return automationStore.value === capturedState;
    }

    return {
        status,
        hasChanges,
        apply,
        revert,
    };
}
