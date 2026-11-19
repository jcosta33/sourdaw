import {
    type Doc,
    type Heads,
    clone,
    decodeChange,
    free,
    getActorId,
    getBackend,
    getChangesMetaSince,
    getHeads,
} from '@automerge/automerge';

import {
    encodeNativeIncrementals,
    retainsActiveFrontier,
    sameNativeHeads,
    type EncodedIncremental,
    type IncrementalEncodingInput,
} from '../models/NativeIncrementalEncoding';

const INCREMENTAL_VALIDATION_FRAMES_PER_TASK = 8;
const INCREMENTAL_VALIDATION_BYTES_PER_TASK = 64 * 1024;

function readHeads(value: unknown): value is Heads {
    return (
        Array.isArray(value) &&
        value.every((head: unknown) => typeof head === 'string' && /^[a-f0-9]{64}$/.test(head)) &&
        new Set(value).size === value.length
    );
}

function assertIncrementalFrameHeader(bytes: Uint8Array, offset: number): void {
    if (
        bytes.length - offset < 10 ||
        bytes[offset] !== 0x85 ||
        bytes[offset + 1] !== 0x6f ||
        bytes[offset + 2] !== 0x4a ||
        bytes[offset + 3] !== 0x83 ||
        (bytes[offset + 8] !== 1 && bytes[offset + 8] !== 2)
    ) {
        throw new Error('Invalid incremental Worker change frame');
    }
}

function readIncrementalFrameEnd(bytes: Uint8Array, offset: number): number {
    let length = 0n;
    for (let index = 0; index < 10; index++) {
        const byte = bytes[offset + 9 + index];
        if (byte === undefined || (index === 9 && byte > 1)) {
            break;
        }
        length |= BigInt(byte & 0x7f) << BigInt(index * 7);
        if ((byte & 0x80) === 0) {
            const payload = offset + 10 + index;
            if ((index > 0 && byte === 0) || length > BigInt(bytes.length - payload)) {
                break;
            }
            return payload + Number(length);
        }
    }
    throw new Error('Invalid incremental Worker change length');
}

function yieldForIncrementalValidation(): Promise<void> {
    const channel = new MessageChannel();
    return new Promise((resolve) => {
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        channel.port2.postMessage(undefined);
    });
}

function assertCapturedFrame(frame: Uint8Array, hash: string, backend: ReturnType<typeof getBackend>): void {
    if (frame[8] === 2) {
        // The decoder recomputes the hash without trusting the stored checksum.
        const checksum = Array.from(frame.subarray(4, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
        if (hash.startsWith(checksum) && decodeChange(frame).hash === hash) {
            return;
        }
    } else {
        const expected = backend.getChangeByHash(hash);
        if (expected?.length === frame.length && frame.every((byte, index) => byte === expected[index])) {
            return;
        }
    }
    throw new Error('Incremental Worker change differs from captured history');
}

/** Verify ordered change membership using the captured document's active history. */
async function assertIncrementalFrames(bytes: Uint8Array, doc: Doc<unknown>, frontier: Heads): Promise<void> {
    await yieldForIncrementalValidation();
    const changes = getChangesMetaSince(doc, retainsActiveFrontier(doc, frontier) ? frontier : []);
    const backend = getBackend(doc);
    let offset = 0;
    let batchFrames = 0;
    let batchBytes = 0;
    for (const { hash } of changes) {
        if (offset === bytes.length) {
            throw new Error('Incremental Worker omitted captured changes');
        }
        assertIncrementalFrameHeader(bytes, offset);
        const end = readIncrementalFrameEnd(bytes, offset);
        const frame = bytes.subarray(offset, end);
        // Compressed and oversized frames each get their own task.
        const cost = frame[8] === 2 ? INCREMENTAL_VALIDATION_BYTES_PER_TASK : frame.byteLength;
        if (
            batchFrames >= INCREMENTAL_VALIDATION_FRAMES_PER_TASK ||
            (batchBytes > 0 && batchBytes + cost > INCREMENTAL_VALIDATION_BYTES_PER_TASK)
        ) {
            await yieldForIncrementalValidation();
            batchFrames = 0;
            batchBytes = 0;
        }
        assertCapturedFrame(frame, hash, backend);
        batchFrames++;
        batchBytes += cost;
        offset = end;
    }
    if (offset !== bytes.length) {
        throw new Error('Incremental Worker returned extra changes');
    }
}

function isEncodedIncremental(value: unknown): value is EncodedIncremental {
    return (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'string' &&
        'heads' in value &&
        readHeads(value.heads) &&
        'chunk' in value &&
        value.chunk instanceof Uint8Array &&
        value.chunk.buffer instanceof ArrayBuffer &&
        value.chunk.byteOffset === 0 &&
        value.chunk.byteLength === value.chunk.buffer.byteLength
    );
}

function readIncrementalResponseDocuments(response: unknown, expectedCount: number): unknown[] {
    if (
        typeof response !== 'object' ||
        response === null ||
        !('type' in response) ||
        response.type !== 'incrementalsEncoded' ||
        !('documents' in response) ||
        !Array.isArray(response.documents) ||
        response.documents.length !== expectedCount
    ) {
        throw new Error('Invalid incremental encoding response membership');
    }
    return response.documents;
}

async function validateEncodedIncrementals(
    response: unknown,
    captured: readonly IncrementalEncodingInput[],
    clones: ReadonlyMap<string, Doc<unknown>>
): Promise<EncodedIncremental[]> {
    const entries = readIncrementalResponseDocuments(response, captured.length);
    const expected = new Map(captured.map((entry) => [entry.id, entry]));
    const result: EncodedIncremental[] = [];
    for (const entry of entries) {
        if (!isEncodedIncremental(entry)) {
            throw new Error('Invalid incremental encoding response document');
        }
        const original = expected.get(entry.id);
        const doc = clones.get(entry.id);
        if (!original || !doc || !sameNativeHeads(original.heads, entry.heads)) {
            throw new Error('Incremental encoding response heads changed');
        }
        await assertIncrementalFrames(entry.chunk, doc, original.frontier);
        expected.delete(entry.id);
        result.push({ id: entry.id, heads: entry.heads, chunk: entry.chunk });
    }
    if (expected.size > 0) {
        throw new Error('Missing incremental encoding response document');
    }
    return result;
}

/** Capture every native version before invoking the asynchronous transport. */
export async function captureNativeIncrementals(
    documents: ReadonlyMap<string, Doc<unknown>>,
    frontiers: ReadonlyMap<string, Heads>,
    request: (captured: IncrementalEncodingInput[]) => Promise<unknown>,
    warn: (error: unknown) => void
): Promise<EncodedIncremental[]> {
    const captured: IncrementalEncodingInput[] = [];
    const clones = new Map<string, Doc<unknown>>();
    const unchanged: EncodedIncremental[] = [];
    try {
        for (const [id, doc] of documents) {
            const heads = getHeads(doc);
            const previousHeads = frontiers.get(id) ?? [];
            const frontier = [...previousHeads];
            if (sameNativeHeads(heads, frontier)) {
                unchanged.push({ id, heads, chunk: new Uint8Array() });
                continue;
            }
            const encoding = clone(doc, { actor: getActorId(doc) });
            clones.set(id, encoding);
            captured.push({ id, heads, frontier, seed: Uint8Array.from(getBackend(encoding).saveNoCompress()) });
        }
        if (captured.length === 0) {
            return unchanged;
        }
        try {
            return [...unchanged, ...(await validateEncodedIncrementals(await request(captured), captured, clones))];
        } catch (error) {
            warn(error);
            return [...unchanged, ...encodeNativeIncrementals(captured)];
        }
    } finally {
        for (const doc of clones.values()) {
            free(doc);
        }
    }
}
