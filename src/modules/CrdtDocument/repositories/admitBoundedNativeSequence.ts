import {
    type DecodedChange,
    type ChangeMetadata,
    type Doc,
    type Heads,
    applyChanges,
    decodeChange,
    encodeChange,
    free,
    getActorId,
    getAuthor,
    getBackend,
    getChangesMetaSince,
    getHeads,
    getMissingDeps,
} from '@automerge/automerge';

import { encodeExactNativeChange } from '../models/EncodeExactNativeChange';
import { sameNativeHeads } from '../models/NativeIncrementalEncoding';
import {
    NATIVE_SEQUENCE_MAX_BYTES,
    NATIVE_SEQUENCE_MAX_OPERATIONS,
    NATIVE_SEQUENCE_HISTORY_BATCH_SIZE,
    isAbsentNativeAuthor,
    hasOpaqueNativeMetadata,
    nativeChangeMessage,
    nativeOperationCount,
} from '../models/NativeMutationSequence';
import {
    isNativeMutationSequence,
    type ProspectiveMutationWorkerResult,
} from '../models/ProspectiveMutationWorkerProtocol';

import { assertCompleteCanonicalChange } from './assertCompleteCanonicalChange';

type Input<TDoc> = {
    candidate: Doc<TDoc>;
    source: Doc<TDoc>;
    result: ProspectiveMutationWorkerResult;
    previousHeads: Heads;
    actor: string;
    message: string | undefined;
    key: string;
    signal: AbortSignal;
    assertCurrent(): void;
};

function yieldToHost(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        function close(): void {
            signal.removeEventListener('abort', abort);
            channel.port1.close();
            channel.port2.close();
        }
        function abort(): void {
            close();
            const reason: unknown = signal.reason;
            reject(reason instanceof Error ? reason : new DOMException('Native sequence cancelled', 'AbortError'));
        }
        channel.port1.onmessage = () => {
            close();
            resolve();
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
            abort();
            return;
        }
        channel.port2.postMessage(undefined);
    });
}

type SequenceMeasureDetail = {
    primaryKey: string;
    sequenceIndex: number | undefined;
    historyIndex?: number;
    visitedChangeCount?: number;
    historyComplete?: boolean;
};

function measure(name: string, start: number, end: number, detail: SequenceMeasureDetail): void {
    performance.measure(name, { start, end, detail });
    performance.clearMeasures(name);
}

function ownBoundedChange(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    if (
        !(bytes instanceof Uint8Array) ||
        !(bytes.buffer instanceof ArrayBuffer) ||
        bytes.byteOffset !== 0 ||
        bytes.byteLength !== bytes.buffer.byteLength ||
        bytes.length > NATIVE_SEQUENCE_MAX_BYTES ||
        bytes[8] !== 1
    ) {
        throw new Error('Invalid bounded native sequence change');
    }
    return Uint8Array.from(bytes);
}

type DecodedAuthorityExpectation = {
    actor: string;
    sequence: number;
    startOp: number;
    dependencies: ReadonlySet<string>;
    message: string | undefined;
    time?: number;
};

function matchesDecodedSequenceIdentity(decoded: DecodedChange, expected: DecodedAuthorityExpectation): boolean {
    return (
        decoded.actor === expected.actor &&
        !hasOpaqueNativeMetadata(decoded) &&
        isAbsentNativeAuthor(decoded.author) &&
        decoded.seq === expected.sequence &&
        decoded.startOp === expected.startOp &&
        Number.isSafeInteger(decoded.time) &&
        (expected.time === undefined || decoded.time === expected.time) &&
        nativeChangeMessage(decoded.message) === nativeChangeMessage(expected.message)
    );
}

function assertDecodedAuthority(decoded: DecodedChange, expected: DecodedAuthorityExpectation): number {
    const operationCount = nativeOperationCount(decoded);
    const dependencies = new Set(decoded.deps);
    if (
        !matchesDecodedSequenceIdentity(decoded, expected) ||
        decoded.deps.length !== dependencies.size ||
        dependencies.size !== expected.dependencies.size ||
        decoded.deps.some((head) => !expected.dependencies.has(head)) ||
        operationCount < 1 ||
        operationCount > NATIVE_SEQUENCE_MAX_OPERATIONS
    ) {
        throw new Error('Native sequence changed captured authority');
    }
    // The decoded operation stream must also survive canonical re-encoding unchanged.
    const { hash, ...canonical } = decoded;
    if (encodeExactNativeChange(canonical, { encodeChange, decodeChange }).hash !== hash) {
        throw new Error('Native sequence contains unsupported opaque metadata');
    }
    return operationCount;
}

type AppliedSequenceExpectation = {
    actor: string;
    previousHeads: Heads;
    decoded: DecodedChange;
    sequence: number;
    startOp: number;
    span: number;
};

function matchesAppliedSequenceHistory(addition: ChangeMetadata, expected: AppliedSequenceExpectation): boolean {
    return (
        addition.hash === expected.decoded.hash &&
        addition.actor === expected.decoded.actor &&
        isAbsentNativeAuthor(addition.author) &&
        !hasOpaqueNativeMetadata(addition) &&
        addition.seq === expected.sequence &&
        addition.startOp === expected.startOp &&
        addition.maxOp === expected.startOp + expected.span - 1 &&
        nativeChangeMessage(addition.message) === nativeChangeMessage(expected.decoded.message) &&
        addition.time === expected.decoded.time &&
        sameNativeHeads(addition.deps, expected.decoded.deps)
    );
}

function assertAppliedSequenceChange<TDoc>(document: Doc<TDoc>, expected: AppliedSequenceExpectation): string {
    if (getMissingDeps(document, []).length > 0 || getMissingDeps(document, expected.previousHeads).length > 0) {
        throw new Error('Native sequence lost its captured dependency frontier');
    }
    const additions = getChangesMetaSince(document, expected.previousHeads);
    const addition = additions[0];
    if (
        additions.length !== 1 ||
        !addition ||
        !matchesAppliedSequenceHistory(addition, expected) ||
        !sameNativeHeads(getHeads(document), [addition.hash]) ||
        getActorId(document) !== expected.actor ||
        !isAbsentNativeAuthor(getAuthor(document))
    ) {
        throw new Error('Native sequence changed native authority');
    }
    return addition.hash;
}

type SequenceCursor<TDoc> = {
    document: Doc<TDoc>;
    sequence: number;
    startOp: number;
    previousOwnHash?: string;
    previousHeads: Heads;
    time?: number;
    operationCount: number;
    ownedSlotChanged: boolean;
    retiredEvidence: boolean;
};

type SourceHistory = { backend: ReturnType<typeof getBackend>; pending: Heads; discovered: Set<string> };

function readSourceHistoryNode<TDoc>(actor: string, cursor: SequenceCursor<TDoc>, history: SourceHistory): void {
    const hash = history.pending.pop();
    if (hash === undefined) {
        throw new Error('Native source history frontier disappeared');
    }
    const entry = history.backend.getChangeMetaByHash(hash);
    if (!entry || entry.hash !== hash) {
        throw new Error('Native source history metadata is unavailable');
    }
    cursor.startOp = Math.max(cursor.startOp, entry.maxOp);
    if (entry.actor === actor && entry.seq > cursor.sequence) {
        cursor.sequence = entry.seq;
        cursor.previousOwnHash = entry.hash;
    }
    for (const dependency of entry.deps) {
        if (!history.discovered.has(dependency)) {
            history.discovered.add(dependency);
            history.pending.push(dependency);
        }
    }
}

async function readSourceSequenceAuthority<TDoc>(
    input: Input<TDoc>,
    cursor: SequenceCursor<TDoc>,
    assertCurrent: () => void,
    history: SourceHistory
): Promise<void> {
    const { pending } = history;
    let visitedChangeCount = 0;
    while (pending.length > 0) {
        await yieldToHost(input.signal);
        const started = performance.now();
        const historyIndex = Math.floor(visitedChangeCount / NATIVE_SEQUENCE_HISTORY_BATCH_SIZE);
        try {
            assertCurrent();
            for (let index = 0; index < NATIVE_SEQUENCE_HISTORY_BATCH_SIZE && pending.length > 0; index++) {
                readSourceHistoryNode(input.actor, cursor, history);
                visitedChangeCount++;
            }
            assertCurrent();
        } finally {
            measure('automerge-prospective-sequence-planning-history-task', started, performance.now(), {
                primaryKey: input.key,
                sequenceIndex: undefined,
                historyIndex,
                visitedChangeCount,
                historyComplete: pending.length === 0,
            });
        }
    }
    cursor.sequence++;
    cursor.startOp++;
}

function admitSequenceChunk<TDoc>(
    input: Input<TDoc>,
    cursor: SequenceCursor<TDoc>,
    chunk: { bytes: Uint8Array<ArrayBuffer>; index: number; totalOperations: number },
    assertCurrent: () => void
): void {
    const { bytes, index, totalOperations } = chunk;
    const started = performance.now();
    assertCurrent();
    let responseEnded = started;
    let applyEnded = started;
    let phase: 'response' | 'apply' | 'authority' = 'response';
    try {
        const decoded = assertCompleteCanonicalChange(bytes);
        const dependencies = new Set(cursor.previousHeads);
        if (cursor.previousOwnHash) {
            dependencies.add(cursor.previousOwnHash);
        }
        const span = assertDecodedAuthority(decoded, {
            actor: input.actor,
            sequence: cursor.sequence,
            startOp: cursor.startOp,
            dependencies,
            message: input.message,
            time: cursor.time,
        });
        if (cursor.operationCount + span > totalOperations) {
            throw new Error('Native sequence operation membership changed');
        }
        cursor.time = decoded.time;
        assertCurrent();
        responseEnded = performance.now();
        phase = 'apply';
        [cursor.document] = applyChanges(cursor.document, [bytes], {
            patchCallback: (patches) => {
                for (const patch of patches) {
                    const retiresEvidence =
                        patch.action === 'del' &&
                        patch.path.length === 1 &&
                        patch.path[0] === '_storagePublicationEvidence';
                    if (patch.path[0] !== input.key && !retiresEvidence) {
                        throw new Error('Prospective mutation Worker changed an unowned slot');
                    }
                    cursor.ownedSlotChanged ||= patch.path[0] === input.key;
                    cursor.retiredEvidence ||= retiresEvidence;
                }
            },
        });
        applyEnded = performance.now();
        phase = 'authority';
        const hash = assertAppliedSequenceChange(cursor.document, {
            actor: input.actor,
            previousHeads: cursor.previousHeads,
            decoded,
            sequence: cursor.sequence,
            startOp: cursor.startOp,
            span,
        });
        assertCurrent();
        cursor.previousHeads = [hash];
        cursor.previousOwnHash = hash;
        cursor.sequence++;
        cursor.startOp += span;
        cursor.operationCount += span;
    } finally {
        const ended = performance.now();
        if (phase === 'response') {
            responseEnded = ended;
            applyEnded = ended;
        } else if (phase === 'apply') {
            applyEnded = ended;
        }
        const detail = { primaryKey: input.key, sequenceIndex: index };
        measure('automerge-prospective-response-task', started, responseEnded, detail);
        measure('automerge-prospective-apply-task', responseEnded, applyEnded, detail);
        measure('automerge-prospective-authority-task', applyEnded, ended, detail);
        measure('automerge-prospective-sequence-slice-task', started, ended, detail);
    }
}

/** Own and admit a private prefix in real host tasks; publication remains synchronous and separate. */
export async function admitBoundedNativeSequence<TDoc>(input: Input<TDoc>): Promise<Doc<TDoc>> {
    let cursor: SequenceCursor<TDoc> | undefined = {
        document: input.candidate,
        sequence: 0,
        startOp: 0,
        previousHeads: input.previousHeads,
        operationCount: 0,
        ownedSlotChanged: false,
        retiredEvidence: false,
    };
    function assertCurrent(): void {
        input.signal.throwIfAborted();
        input.assertCurrent();
    }
    try {
        const state = cursor;
        const planningStarted = performance.now();
        assertCurrent();
        const sequence = input.result.sequence;
        if (!isNativeMutationSequence(sequence, input.result.changes.length)) {
            throw new Error('Invalid native sequence membership');
        }
        const changes = input.result.changes.map(ownBoundedChange);
        const finalHeads = [...input.result.heads];
        const pending = getHeads(input.source);
        const history = { backend: getBackend(input.source), pending, discovered: new Set(pending) };
        assertCurrent();
        measure('automerge-prospective-sequence-planning-task', planningStarted, performance.now(), {
            primaryKey: input.key,
            sequenceIndex: undefined,
        });
        await readSourceSequenceAuthority(input, state, assertCurrent, history);
        for (const [index, bytes] of changes.entries()) {
            await yieldToHost(input.signal);
            admitSequenceChunk(input, state, { bytes, index, totalOperations: sequence.operationCount }, assertCurrent);
        }
        if (
            state.operationCount !== sequence.operationCount ||
            !sameNativeHeads(getHeads(state.document), finalHeads)
        ) {
            throw new Error('Native sequence final membership or heads changed');
        }
        if (state.retiredEvidence && !state.ownedSlotChanged) {
            throw new Error('Prospective mutation Worker changed only publication evidence');
        }
        assertCurrent();
        cursor = undefined;
        return state.document;
    } finally {
        if (cursor) {
            free(cursor.document);
        }
    }
}
