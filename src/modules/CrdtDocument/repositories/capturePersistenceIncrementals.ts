import {
    type Doc,
    type Heads,
    clone,
    free,
    getActorId,
    getBackend,
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

function readEncodedDocument(value: unknown): EncodedIncremental | undefined {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        !Array.isArray(value.heads) ||
        !value.heads.every((head: unknown) => typeof head === 'string')
    ) {
        return undefined;
    }

    const chunk = value.chunk;
    if (
        !(chunk instanceof Uint8Array) ||
        !(chunk.buffer instanceof ArrayBuffer) ||
        chunk.buffer.detached ||
        chunk.byteOffset !== 0 ||
        chunk.byteLength !== chunk.buffer.byteLength ||
        (chunk.byteLength === 0 && value.heads.length > 0)
    ) {
        return undefined;
    }
    return { id: value.id, heads: value.heads, chunk: new Uint8Array(chunk.buffer) };
}

function readEncodedBatch(
    reply: unknown,
    captures: ReadonlyMap<string, RetainedCapture>
): EncodedIncremental[] | undefined {
    if (!isRecord(reply) || reply.type !== 'incrementalsEncoded' || !Array.isArray(reply.documents)) {
        return undefined;
    }
    const documents: unknown[] = reply.documents;
    if (documents.length !== captures.size) {
        return undefined;
    }
    const byId = new Map<string, EncodedIncremental>();
    for (const value of documents) {
        const document = readEncodedDocument(value);
        if (!document || byId.has(document.id)) {
            return undefined;
        }
        byId.set(document.id, document);
    }

    const encoded: EncodedIncremental[] = [];
    for (const [id, capture] of captures) {
        const match = byId.get(id);
        if (!match || !haveSameHeads(match.heads, capture.heads)) {
            return undefined;
        }
        encoded.push({ id, heads: capture.heads, chunk: match.chunk });
    }
    return encoded;
}

function hasCompleteNativeHistory(document: Doc<unknown>, heads: Heads): boolean {
    return getMissingDeps(document, heads).length === 0;
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
        const encoded = readEncodedBatch(reply, captures);
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
