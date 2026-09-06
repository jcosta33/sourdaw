function areJsonValuesEqual(current: unknown, captured: unknown): boolean {
    if (current === captured) {
        return true;
    }
    if (Array.isArray(current) || Array.isArray(captured)) {
        return (
            Array.isArray(current) &&
            Array.isArray(captured) &&
            current.length === captured.length &&
            current.every((value, index) => areJsonValuesEqual(value, captured[index]))
        );
    }
    if (current === null || captured === null || typeof current !== 'object' || typeof captured !== 'object') {
        return false;
    }

    const currentRecord = current as Record<string, unknown>;
    const capturedRecord = captured as Record<string, unknown>;
    const currentKeys = Object.keys(currentRecord);
    const capturedKeys = Object.keys(capturedRecord);
    return (
        currentKeys.length === capturedKeys.length &&
        currentKeys.every(
            (key) => Object.hasOwn(capturedRecord, key) && areJsonValuesEqual(currentRecord[key], capturedRecord[key])
        )
    );
}

export function isJsonEntityEqual(entity: object, capturedJson: string): boolean {
    try {
        const currentJson = JSON.stringify(entity);
        if (currentJson === undefined) {
            return false;
        }
        return areJsonValuesEqual(JSON.parse(currentJson), JSON.parse(capturedJson));
    } catch {
        return false;
    }
}
