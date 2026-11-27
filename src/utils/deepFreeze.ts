/**
 * Freezes `value` and everything reachable from it, so a value shared between readers cannot be
 * changed under any of them. An object already frozen is taken as frozen throughout.
 */
export function deepFreeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}
