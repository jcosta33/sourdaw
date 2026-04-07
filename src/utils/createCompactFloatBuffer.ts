type CreateCompactFloatBufferInput = {
    length: number;
    fill?: number;
};

const CompactFloatArray =
    (Reflect.get(globalThis, 'Float16Array') as unknown as typeof Float32Array | undefined) ?? Float32Array;

export function createCompactFloatBuffer({ length, fill }: CreateCompactFloatBufferInput): Float32Array {
    const buffer = new CompactFloatArray(length);
    if (fill !== undefined) {
        buffer.fill(fill);
    }
    return buffer;
}
