/** Share a destructive reading only when callers supply the same actual RAF timestamp. */
export function createMeterFrameReader<Key, Value>(read: (key: Key) => Value) {
    let currentFrame: DOMHighResTimeStamp | undefined;
    const readings = new Map<Key, { value: Value }>();
    return (key: Key, frameTime?: DOMHighResTimeStamp): Value => {
        if (frameTime === undefined || !Number.isFinite(frameTime)) {
            return read(key);
        }
        if (frameTime !== currentFrame) {
            readings.clear();
            currentFrame = frameTime;
        }
        const cached = readings.get(key);
        if (cached) {
            return cached.value;
        }
        const value = read(key);
        readings.set(key, { value });
        return value;
    };
}
