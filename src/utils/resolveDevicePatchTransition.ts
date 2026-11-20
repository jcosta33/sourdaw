import { valuesEqual } from './structuralEquality';

type DevicePatchChunk = { version: number; data: Record<string, unknown> };
type Snapshot<Chunk extends DevicePatchChunk> = {
    deviceState: Chunk | null;
    parameterValues: Record<string, number | null>;
};

export type DevicePatchTransitionMetadata<Chunk extends DevicePatchChunk> = {
    field: string;
    allowedValues: readonly string[];
    missingChunk: Chunk;
};

function readField(chunk: DevicePatchChunk | null, field: string): unknown {
    return chunk && Object.hasOwn(chunk.data, field) ? chunk.data[field] : undefined;
}

function withoutField<Chunk extends DevicePatchChunk>(chunk: Chunk, field: string): Chunk {
    const data = Object.fromEntries(Object.entries(chunk.data).filter(([key]) => key !== field));
    return { ...chunk, data };
}

function chunksSupportMetadata<Chunk extends DevicePatchChunk>(
    chunks: readonly (Chunk | null)[],
    { field, allowedValues, missingChunk }: DevicePatchTransitionMetadata<Chunk>
): boolean {
    if (Object.hasOwn(missingChunk.data, field)) {
        return false;
    }
    return chunks.every((chunk) => {
        if (chunk === null) {
            return true;
        }
        const value = readField(chunk, field);
        return (
            chunk.version === missingChunk.version &&
            (!Object.hasOwn(chunk.data, field) || (typeof value === 'string' && allowedValues.includes(value)))
        );
    });
}

function preserveDevicePatchMetadata<Chunk extends DevicePatchChunk>(
    current: Snapshot<Chunk>,
    expected: Snapshot<Chunk>,
    next: Snapshot<Chunk>,
    metadata: DevicePatchTransitionMetadata<Chunk>
): { expected: Snapshot<Chunk>; next: Snapshot<Chunk> } | null {
    const { field, missingChunk } = metadata;
    if (!chunksSupportMetadata([current.deviceState, expected.deviceState, next.deviceState], metadata)) {
        return null;
    }

    const currentField = readField(current.deviceState, field);
    const expectedField = readField(expected.deviceState, field);
    const nextField = readField(next.deviceState, field);
    if (
        currentField === expectedField ||
        expectedField !== nextField ||
        !valuesEqual(
            current.deviceState ? withoutField(current.deviceState, field) : missingChunk,
            expected.deviceState ? withoutField(expected.deviceState, field) : missingChunk
        )
    ) {
        return null;
    }

    const destination = next.deviceState ? withoutField(next.deviceState, field) : null;
    let deviceState = destination;
    if (typeof currentField === 'string') {
        const template = destination ?? missingChunk;
        deviceState = { ...template, data: { ...template.data, [field]: currentField } };
    }
    return { expected: current, next: { deviceState, parameterValues: next.parameterValues } };
}

/** Match the captured footprint and carry only explicitly independent metadata into the exact write. */
export function resolveDevicePatchTransition<Chunk extends DevicePatchChunk>(
    current: Snapshot<Chunk>,
    expected: Snapshot<Chunk>,
    next: Snapshot<Chunk>,
    metadata?: DevicePatchTransitionMetadata<Chunk>
): { expected: Snapshot<Chunk>; next: Snapshot<Chunk> } | null {
    if (
        !valuesEqual(current.parameterValues, expected.parameterValues) ||
        !valuesEqual(Object.keys(expected.parameterValues).sort(), Object.keys(next.parameterValues).sort())
    ) {
        return null;
    }
    if (valuesEqual(current.deviceState, expected.deviceState)) {
        return { expected, next };
    }
    if (!metadata) {
        return null;
    }

    return preserveDevicePatchMetadata(current, expected, next, metadata);
}
