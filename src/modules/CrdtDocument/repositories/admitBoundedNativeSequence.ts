import {
    type DecodedChange,
    type Doc,
    type Heads,
    applyChanges,
    decodeChange,
    encodeChange,
    free,
    getActorId,
    getAuthor,
    getChangesMetaSince,
    getHeads,
    getMissingDeps,
} from '@automerge/automerge';

import { sameNativeHeads } from '../models/NativeIncrementalEncoding';
import {
    NATIVE_SEQUENCE_MAX_BYTES,
    NATIVE_SEQUENCE_MAX_OPERATIONS,
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

function measure(name: string, start: number, end: number, index?: number): void {
    performance.measure(name, { start, end, detail: { sequenceIndex: index } });
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

function assertDecodedAuthority(
    decoded: DecodedChange,
    expected: {
        actor: string;
        sequence: number;
        startOp: number;
        dependencies: ReadonlySet<string>;
        message: string | undefined;
        time?: number;
    }
): number {
    const operationCount = nativeOperationCount(decoded);
    const dependencies = new Set(decoded.deps);
    if (
        decoded.actor !== expected.actor ||
        hasOpaqueNativeMetadata(decoded) ||
        !isAbsentNativeAuthor(decoded.author) ||
        decoded.seq !== expected.sequence ||
        decoded.startOp !== expected.startOp ||
        !Number.isSafeInteger(decoded.time) ||
        (expected.time !== undefined && decoded.time !== expected.time) ||
        nativeChangeMessage(decoded.message) !== nativeChangeMessage(expected.message) ||
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
    if (decodeChange(encodeChange(canonical)).hash !== hash) {
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

function assertAppliedSequenceChange<TDoc>(document: Doc<TDoc>, expected: AppliedSequenceExpectation): string {
    if (getMissingDeps(document, []).length > 0 || getMissingDeps(document, expected.previousHeads).length > 0) {
        throw new Error('Native sequence lost its captured dependency frontier');
    }
    const additions = getChangesMetaSince(document, expected.previousHeads);
    const addition = additions[0];
    if (
        additions.length !== 1 ||
        !addition ||
        addition.hash !== expected.decoded.hash ||
        addition.actor !== expected.decoded.actor ||
        !isAbsentNativeAuthor(addition.author) ||
        hasOpaqueNativeMetadata(addition) ||
        addition.seq !== expected.sequence ||
        addition.startOp !== expected.startOp ||
        addition.maxOp !== expected.startOp + expected.span - 1 ||
        nativeChangeMessage(addition.message) !== nativeChangeMessage(expected.decoded.message) ||
        addition.time !== expected.decoded.time ||
        !sameNativeHeads(addition.deps, expected.decoded.deps) ||
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

function admitSequenceChunk<TDoc>(
    input: Input<TDoc>,
    cursor: SequenceCursor<TDoc>,
    bytes: Uint8Array<ArrayBuffer>,
    index: number,
    totalOperations: number,
    assertCurrent: () => void
): void {
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
        measure('automerge-prospective-response-task', started, responseEnded, index);
        measure('automerge-prospective-apply-task', responseEnded, applyEnded, index);
        measure('automerge-prospective-authority-task', applyEnded, ended, index);
        measure('automerge-prospective-sequence-slice-task', started, ended, index);
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
        const history = getChangesMetaSince(input.source, []);
        const ownHistory = history.filter((entry) => entry.actor === input.actor);
        const latestOwn = ownHistory.reduce<(typeof ownHistory)[number] | undefined>(
            (latest, entry) => (!latest || entry.seq > latest.seq ? entry : latest),
            undefined
        );
        state.sequence = (latestOwn?.seq ?? 0) + 1;
        state.startOp = history.reduce((maximum, entry) => Math.max(maximum, entry.maxOp), 0) + 1;
        state.previousOwnHash = latestOwn?.hash;
        assertCurrent();
        measure('automerge-prospective-sequence-planning-task', planningStarted, performance.now());
        for (const [index, bytes] of changes.entries()) {
            await yieldToHost(input.signal);
            admitSequenceChunk(input, state, bytes, index, sequence.operationCount, assertCurrent);
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
