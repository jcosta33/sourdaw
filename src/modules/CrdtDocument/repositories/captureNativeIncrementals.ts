import { type Doc, type Heads, clone, free, getActorId, getBackend, getHeads } from '@automerge/automerge';

import {
    sameNativeHeads,
    type EncodedIncremental,
    type IncrementalEncodingInput,
} from '../models/NativeIncrementalEncoding';

import { encodeNativeIncrementals } from './encodeNativeIncrementals';

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

/** Framing only: native semantic integrity belongs to the encoder and replay checks. */
function assertIncrementalFrames(bytes: Uint8Array): void {
    if (bytes.length === 0) {
        throw new Error('Incremental Worker omitted changed-document bytes');
    }
    let offset = 0;
    while (offset < bytes.length) {
        assertIncrementalFrameHeader(bytes, offset);
        offset = readIncrementalFrameEnd(bytes, offset);
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

function validateEncodedIncrementals(
    response: unknown,
    captured: readonly IncrementalEncodingInput[]
): EncodedIncremental[] {
    const entries = readIncrementalResponseDocuments(response, captured.length);
    const expected = new Map(captured.map((entry) => [entry.id, entry.heads]));
    const result: EncodedIncremental[] = [];
    for (const entry of entries) {
        if (!isEncodedIncremental(entry)) {
            throw new Error('Invalid incremental encoding response document');
        }
        const heads = expected.get(entry.id);
        if (!heads || !sameNativeHeads(heads, entry.heads)) {
            throw new Error('Incremental encoding response heads changed');
        }
        assertIncrementalFrames(entry.chunk);
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
    const clones: Doc<unknown>[] = [];
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
            clones.push(encoding);
            captured.push({ id, heads, frontier, seed: Uint8Array.from(getBackend(encoding).saveNoCompress()) });
        }
        if (captured.length === 0) {
            return unchanged;
        }
        try {
            return [...unchanged, ...validateEncodedIncrementals(await request(captured), captured)];
        } catch (error) {
            warn(error);
            return [...unchanged, ...encodeNativeIncrementals(captured)];
        }
    } finally {
        for (const doc of clones) {
            free(doc);
        }
    }
}
