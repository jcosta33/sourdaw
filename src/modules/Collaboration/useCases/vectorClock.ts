export type VectorClock = Record<string, number>;

export const createClock = (): VectorClock => ({});

export const increment = (clock: VectorClock, peerId: string): VectorClock => ({
    ...clock,
    [peerId]: (clock[peerId] ?? 0) + 1,
});

export const merge = (a: VectorClock, b: VectorClock): VectorClock => {
    const result = { ...a };
    for (const [key, value] of Object.entries(b)) {
        result[key] = Math.max(result[key] ?? 0, value);
    }
    return result;
};

export const happensBefore = (a: VectorClock, b: VectorClock): boolean => {
    let allLessOrEqual = true;
    let someStrictlyLess = false;

    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
        const aVal = a[key] ?? 0;
        const bVal = b[key] ?? 0;
        if (aVal > bVal) {
            allLessOrEqual = false;
        }
        if (aVal < bVal) {
            someStrictlyLess = true;
        }
    }

    return allLessOrEqual && someStrictlyLess;
};

export const areConcurrent = (a: VectorClock, b: VectorClock): boolean => {
    return !happensBefore(a, b) && !happensBefore(b, a);
};
