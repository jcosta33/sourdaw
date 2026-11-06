const INCARNATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(0|[1-9][0-9]{0,19})$/;
const SATURATED_EPOCH = 18_446_744_073_709_551_615n;

/** A native control-side witness, kept as text so no epoch crosses a JS number. */
export function readNativeEngineIncarnation(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = INCARNATION.exec(value);
    const epoch = match?.[1];
    if (epoch === undefined || BigInt(epoch) >= SATURATED_EPOCH) {
        return undefined;
    }
    return value;
}
