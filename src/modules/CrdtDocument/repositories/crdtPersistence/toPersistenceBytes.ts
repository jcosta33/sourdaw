function isPersistenceUint8Array(value: unknown): value is Uint8Array {
    return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/** Normalize typed-array values returned by an IndexedDB realm boundary. */
export function toPersistenceBytes(value: unknown): Uint8Array | null {
    if (!isPersistenceUint8Array(value)) {
        return null;
    }

    return Uint8Array.from(value);
}
