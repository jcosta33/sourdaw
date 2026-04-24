type CreateCompactFloatBufferInput = {
    length: number;
    fill?: number;
};

// eslint-disable-next-line sourdaw/no-type-assertion-escape -- Float16Array is a Stage 3 proposal absent from TypeScript's lib; reflective access requires double cast
const NativeFloat16Array = Reflect.get(globalThis, 'Float16Array') as unknown as typeof Float32Array | undefined;
const CompactFloatArray = NativeFloat16Array ?? Float32Array;

export function createCompactFloatBuffer({ length, fill }: CreateCompactFloatBufferInput): Float32Array {
    const buffer = new CompactFloatArray(length);
    if (fill !== undefined) {
        buffer.fill(fill);
    }
    return buffer;
}
