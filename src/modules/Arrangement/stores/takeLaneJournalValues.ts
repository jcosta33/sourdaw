import { type Take, type TakeLane } from '../models/TakeLane';

import {
    type OptionalMidiSourceValue,
    type OptionalNumberValue,
    type OptionalStringValue,
    type OptionalTakeNumberField,
} from './takeLaneWriteJournalTypes';

export function cloneValue<Value>(value: Value): Value {
    return structuredClone(value);
}

export function valuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((value, index) => valuesEqual(value, right[index]))
        );
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return false;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(leftRecord[key], rightRecord[key]))
    );
}

export function optionalString(source: TakeLane, field: 'automationLaneId'): OptionalStringValue {
    if (Object.hasOwn(source, field) && source[field] !== undefined) {
        return { present: true, value: source[field] };
    }
    return { present: false };
}

export function optionalNumber(source: Take, field: OptionalTakeNumberField): OptionalNumberValue {
    if (Object.hasOwn(source, field) && source[field] !== undefined) {
        return { present: true, value: source[field] };
    }
    return { present: false };
}

export function optionalMidiSource(take: Take): OptionalMidiSourceValue {
    return take.midiSource === undefined ? { present: false } : { present: true, value: cloneValue(take.midiSource) };
}
