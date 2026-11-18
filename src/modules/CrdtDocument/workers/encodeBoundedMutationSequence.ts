import {
    decodeChange,
    encodeChange,
    getActorId,
    getAuthor,
    getChangesMetaSince,
    getChangesSince,
    getHeads,
    type Doc,
    type DecodedChange,
    type ChangeMetadata,
} from '@automerge/automerge/slim';

import { encodeExactNativeChange } from '../models/EncodeExactNativeChange';
import {
    NATIVE_SEQUENCE_MAX_BYTES,
    NATIVE_SEQUENCE_MAX_OPERATIONS,
    isAbsentNativeAuthor,
    hasOpaqueNativeMetadata,
    nativeChangeMessage,
    nativeOperationCount,
} from '../models/NativeMutationSequence';
import { type ProspectiveMutationWorkerResult } from '../models/ProspectiveMutationWorkerProtocol';

function matchesCanonicalChangeHistory(decoded: DecodedChange, metadata: ChangeMetadata): boolean {
    return (
        decoded.seq === metadata.seq &&
        decoded.hash === metadata.hash &&
        nativeChangeMessage(decoded.message) === nativeChangeMessage(metadata.message) &&
        decoded.time === metadata.time &&
        Number.isSafeInteger(decoded.time) &&
        decoded.startOp === metadata.startOp &&
        metadata.maxOp - metadata.startOp + 1 === nativeOperationCount(decoded)
    );
}

function assertCanonicalNativeMetadata(
    document: Doc<unknown>,
    decoded: DecodedChange,
    metadata: ChangeMetadata | undefined
): void {
    if (
        !metadata ||
        !isAbsentNativeAuthor(decoded.author) ||
        !isAbsentNativeAuthor(metadata.author) ||
        hasOpaqueNativeMetadata(metadata) ||
        hasOpaqueNativeMetadata(decoded) ||
        decoded.actor !== getActorId(document) ||
        !matchesCanonicalChangeHistory(decoded, metadata)
    ) {
        throw new Error('Unsupported canonical native change metadata');
    }
}

/** Reframe the canonical operation stream without changing its native operation identities. */
export function encodeBoundedMutationSequence(
    document: Doc<unknown>,
    previousHeads: readonly string[]
): ProspectiveMutationWorkerResult {
    const changes = getChangesSince(document, [...previousHeads]);
    if (changes.length === 0) {
        return { changes: [], heads: getHeads(document), sequence: { changeCount: 0, operationCount: 0 } };
    }
    if (changes.length !== 1 || !isAbsentNativeAuthor(getAuthor(document))) {
        throw new Error('Bounded native preparation requires one canonical no-author change');
    }
    const original = changes[0];
    if (!original) {
        throw new Error('Canonical native change is missing');
    }
    const decoded = decodeChange(original);
    const metadata = getChangesMetaSince(document, [...previousHeads])[0];
    assertCanonicalNativeMetadata(document, decoded, metadata);
    const { hash: _derivedHash, ...template } = decoded;
    const bounded: Uint8Array<ArrayBuffer>[] = [];
    let previousHash: string | undefined;
    for (let offset = 0; offset < decoded.ops.length; offset += NATIVE_SEQUENCE_MAX_OPERATIONS) {
        const index = bounded.length;
        let dependencies = decoded.deps;
        if (index > 0) {
            if (!previousHash) {
                throw new Error('Native sequence dependency is missing');
            }
            dependencies = [previousHash];
        }
        const { bytes, hash } = encodeExactNativeChange(
            {
                ...template,
                seq: decoded.seq + index,
                startOp: decoded.startOp + offset,
                deps: dependencies,
                ops: decoded.ops.slice(offset, offset + NATIVE_SEQUENCE_MAX_OPERATIONS),
            },
            { encodeChange, decodeChange }
        );
        if (bytes.length > NATIVE_SEQUENCE_MAX_BYTES || bytes[8] !== 1) {
            throw new Error('Native sequence change exceeds its uncompressed bound');
        }
        previousHash = hash;
        bounded.push(bytes);
    }
    if (!previousHash) {
        throw new Error('Canonical native operation stream is empty');
    }
    return {
        changes: bounded,
        heads: [previousHash],
        sequence: { changeCount: bounded.length, operationCount: decoded.ops.length },
    };
}
