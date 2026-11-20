import {
    type Doc,
    type Heads,
    clone,
    free,
    getActorId,
    getBackend,
    getChangesMetaSince,
    getHeads,
    getMissingDeps,
    saveSince,
} from '@automerge/automerge';

import { logger } from '#/infra/logger/appLogger';
import { isRecord } from '#/utils/structuralEquality';

import { type EncodedIncremental, type IncrementalEncodingInput } from '../models/IncrementalPersistenceEncoding';

import { retainsActiveFrontier } from './retainsActiveFrontier';

type CaptureInput = {
    documents: Iterable<readonly [string, Doc<unknown>]>;
    exportFrontiers: ReadonlyMap<string, Heads>;
    request: (documents: IncrementalEncodingInput[], signal: AbortSignal) => Promise<unknown>;
    signal: AbortSignal;
};

type RetainedCapture = { readonly document: Doc<unknown>; readonly heads: Heads; readonly frontier: Heads };

function haveSameHeads(observed: readonly unknown[], expected: Heads): boolean {
    return observed.length === expected.length && expected.every((head) => observed.includes(head));
}

type ReceivedDocument = { id: string; heads: Heads; frames: unknown[] };

const FRAMES_PER_TASK = 8;
const FRAME_BYTES_PER_TASK = 64 * 1024;

function readEncodedDocument(value: unknown): ReceivedDocument | undefined {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        !Array.isArray(value.heads) ||
        !value.heads.every((head: unknown) => typeof head === 'string') ||
        !Array.isArray(value.frames)
    ) {
        return undefined;
    }
    return { id: value.id, heads: value.heads, frames: value.frames };
}

function readEncodedBatch(reply: unknown, count: number): ReadonlyMap<string, ReceivedDocument> | undefined {
    if (!isRecord(reply) || reply.type !== 'incrementalsEncoded' || !Array.isArray(reply.documents)) {
        return undefined;
    }
    const documents: unknown[] = reply.documents;
    if (documents.length !== count) {
        return undefined;
    }
    const byId = new Map<string, ReceivedDocument>();
    for (const value of documents) {
        const document = readEncodedDocument(value);
        if (!document || byId.has(document.id)) {
            return undefined;
        }
        byId.set(document.id, document);
    }
    return byId;
}

function hasCompleteNativeHistory(document: Doc<unknown>, heads: Heads): boolean {
    return getMissingDeps(document, heads).length === 0;
}

async function yieldValidationTask(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        function finish(): void {
            signal.removeEventListener('abort', finish);
            channel.port1.close();
            channel.port2.close();
            resolve();
        }
        channel.port1.onmessage = finish;
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) {
            finish();
            return;
        }
        channel.port2.postMessage(undefined);
    });
    signal.throwIfAborted();
}

function isOwnedFrame(frame: unknown): frame is Uint8Array<ArrayBuffer> {
    return (
        frame instanceof Uint8Array &&
        frame.buffer instanceof ArrayBuffer &&
        !frame.buffer.detached &&
        frame.byteOffset === 0 &&
        frame.byteLength > 0 &&
        frame.byteLength === frame.buffer.byteLength
    );
}

function concatenateFrames(frames: readonly Uint8Array[], byteLength: number): Uint8Array<ArrayBuffer> {
    const chunk = new Uint8Array(byteLength);
    let offset = 0;
    for (const frame of frames) {
        chunk.set(frame, offset);
        offset += frame.byteLength;
    }
    return chunk;
}

function readMatchingFrame(
    backend: ReturnType<typeof getBackend>,
    hash: string,
    frame: Uint8Array
): Uint8Array | undefined {
    const captured = backend.getChangeByHash(hash);
    if (captured?.byteLength === frame.byteLength && captured.every((byte, index) => byte === frame[index])) {
        return captured;
    }
    return undefined;
}

async function verifyCapturedFrames(
    { document, heads, frontier }: RetainedCapture,
    frames: unknown[],
    signal: AbortSignal
): Promise<Uint8Array<ArrayBuffer> | undefined> {
    await yieldValidationTask(signal);
    signal.throwIfAborted();
    // The capture is a private clone of the checked backing tip. As in the
    // Worker, all applied changes are reachable from its current heads.
    const alreadyCurrent = frontier.every((head) => heads.includes(head));
    const activeFrontier = alreadyCurrent || hasCompleteNativeHistory(document, frontier) ? frontier : [];
    const expected = getChangesMetaSince(document, activeFrontier);
    if (expected.length !== frames.length || (frames.length === 0 && heads.length > 0)) {
        return undefined;
    }

    const backend = getBackend(document);
    const verified: Uint8Array[] = [];
    let byteLength = 0;
    let batchFrames = 0;
    let batchBytes = 0;
    for (const { hash } of expected) {
        const frame = frames[verified.length];
        if (!isOwnedFrame(frame)) {
            return undefined;
        }
        if (
            batchFrames === 0 ||
            batchFrames >= FRAMES_PER_TASK ||
            batchBytes + frame.byteLength > FRAME_BYTES_PER_TASK
        ) {
            await yieldValidationTask(signal);
            signal.throwIfAborted();
            batchFrames = 0;
            batchBytes = 0;
        }
        const captured = readMatchingFrame(backend, hash, frame);
        if (!captured) {
            return undefined;
        }
        // Keep the private native bytes, which cannot change during later yields.
        verified.push(captured);
        byteLength += captured.byteLength;
        batchFrames++;
        batchBytes += captured.byteLength;
    }
    return concatenateFrames(verified, byteLength);
}

async function admitEncodedBatch(
    reply: unknown,
    captures: ReadonlyMap<string, RetainedCapture>,
    signal: AbortSignal
): Promise<EncodedIncremental[] | undefined> {
    const byId = readEncodedBatch(reply, captures.size);
    if (!byId) {
        return undefined;
    }
    const encoded: EncodedIncremental[] = [];
    for (const [id, capture] of captures) {
        const match = byId.get(id);
        if (!match || !haveSameHeads(match.heads, capture.heads)) {
            return undefined;
        }
        const chunk = await verifyCapturedFrames(capture, match.frames, signal);
        signal.throwIfAborted();
        if (!chunk) {
            return undefined;
        }
        encoded.push({ id, heads: capture.heads, chunk });
    }
    return encoded;
}

function encodeRetainedBatch(captures: ReadonlyMap<string, RetainedCapture>): EncodedIncremental[] {
    return Array.from(captures, ([id, { document, heads, frontier }]) => {
        const activeFrontier = retainsActiveFrontier(document, frontier, hasCompleteNativeHistory) ? frontier : [];
        const chunk = Uint8Array.from(saveSince(document, activeFrontier));
        if (heads.length > 0 && chunk.byteLength === 0) {
            throw new Error(`[AutomergeRepository] Empty incremental bytes for changed document ${id}`);
        }
        return { id, heads, chunk };
    });
}

export async function capturePersistenceIncrementals({
    documents,
    exportFrontiers,
    request,
    signal,
}: CaptureInput): Promise<EncodedIncremental[]> {
    signal.throwIfAborted();
    const captures = new Map<string, RetainedCapture>();
    const inputs: IncrementalEncodingInput[] = [];
    try {
        for (const [id, document] of documents) {
            const heads = getHeads(document);
            if (!haveSameHeads(getBackend(document).getHeads(), heads)) {
                throw new RangeError(`Cannot export incremental bytes for outdated document ${id}`);
            }
            const frontier = exportFrontiers.get(id)?.slice() ?? [];
            if (haveSameHeads(frontier, heads)) {
                continue;
            }
            if (captures.has(id)) {
                throw new Error(`[AutomergeRepository] Duplicate incremental capture document ${id}`);
            }
            const privateDocument = clone(document, { actor: getActorId(document) });
            captures.set(id, { document: privateDocument, heads, frontier });
            inputs.push({
                id,
                seed: Uint8Array.from(getBackend(privateDocument).saveNoCompress()),
                heads: heads.slice(),
                frontier: frontier.slice(),
            });
        }
        signal.throwIfAborted();
        if (inputs.length === 0) {
            return [];
        }

        let reply: unknown;
        try {
            reply = await request(inputs, signal);
        } catch (error) {
            signal.throwIfAborted();
            logger.warn(
                '[AutomergeRepository] CRDT worker failed to encode incrementals, using retained captures:',
                error
            );
            return encodeRetainedBatch(captures);
        }
        signal.throwIfAborted();
        const encoded = await admitEncodedBatch(reply, captures, signal);
        signal.throwIfAborted();
        if (encoded) {
            return encoded;
        }
        logger.warn('[AutomergeRepository] CRDT worker returned invalid incremental encoding, using retained captures');
        return encodeRetainedBatch(captures);
    } finally {
        for (const { document } of captures.values()) {
            free(document);
        }
    }
}
