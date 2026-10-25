import {
    AutomergeStorageWriteConflictError,
    getCurrentAutomergeStorageMutationOwner,
} from '#/infra/store/storage/createAutomergeStorage';
import { isRecord } from '#/utils/structuralEquality';
import { type applyTempoAudioSources } from '#/modules/Arrangement/useCases';
import { tempoAudioSourceCoverageMatches } from '#/utils/tempoAudioSourceCoverage';
import { normalizeTempoSourceOwnerContext } from '#/utils/tempoAudioSourcePromotion';

type Slot = 'transport' | 'tempoMap';
type SourcePreservation = Extract<
    ReturnType<typeof applyTempoAudioSources>,
    { status: 'written' }
>['sourcePreservation'];
export type TempoWriteIntent = {
    readonly tempoChangeId: string | null;
    readonly expectedBpm: number;
    readonly bpm: number;
    readonly sourcePreservation?: SourcePreservation;
};

let pending: { readonly intent: TempoWriteIntent; readonly owner: object | undefined } | undefined;
let pendingSource: { readonly value: SourcePreservation; readonly owner: object | undefined } | undefined;

/** Supplied only after actual Arrangement admission, then consumed synchronously. */
export function runWithTempoSourcePreservation<Result>(value: SourcePreservation, callback: () => Result): Result {
    const previous = pendingSource;
    pendingSource = { value: structuredClone(value), owner: getCurrentAutomergeStorageMutationOwner() };
    try {
        return callback();
    } finally {
        pendingSource = previous;
    }
}

/** Only the synchronous scalar writer can supply this adapter metadata. */
export function runWithTempoWriteIntent<Result>(intent: TempoWriteIntent, callback: () => Result): Result {
    const source = pendingSource;
    pendingSource = undefined;
    if (source && source.owner !== getCurrentAutomergeStorageMutationOwner()) {
        throw new AutomergeStorageWriteConflictError('Tempo source preservation belongs to another mutation owner');
    }
    let captured = structuredClone(intent);
    if (source) {
        captured = { ...captured, sourcePreservation: structuredClone(source.value) };
    }
    const previous = pending;
    pending = { intent: captured, owner: getCurrentAutomergeStorageMutationOwner() };
    try {
        return callback();
    } finally {
        pending = previous;
    }
}

export function captureTempoWriteMetadata(slot: Slot): readonly TempoWriteIntent[] | null {
    const captured = pending;
    pending = undefined;
    if (!captured) {
        return null;
    }
    if (
        captured.owner !== getCurrentAutomergeStorageMutationOwner() ||
        (captured.intent.tempoChangeId === null) !== (slot === 'transport')
    ) {
        throw new AutomergeStorageWriteConflictError('Tempo scalar intent belongs to another mutation owner or slot');
    }
    return [structuredClone(captured.intent)];
}

function rawTempo(document: Readonly<Record<string, unknown>>, tempoChangeId: string | null): number | null {
    if (tempoChangeId === null) {
        const transport = document.transport;
        return isRecord(transport) &&
            typeof transport.tempo === 'number' &&
            Number.isFinite(transport.tempo) &&
            transport.tempo > 0
            ? transport.tempo
            : null;
    }
    const changes = isRecord(document.tempoMap) ? document.tempoMap.changes : null;
    if (!Array.isArray(changes)) {
        return null;
    }
    const matching = changes.filter((change) => isRecord(change) && change.id === tempoChangeId);
    const change: unknown = matching.length === 1 ? matching[0] : null;
    return isRecord(change) && typeof change.tempo === 'number' && Number.isFinite(change.tempo) && change.tempo > 0
        ? change.tempo
        : null;
}

/** Validate the raw first scalar and every subsequent transition in order.
 * The desired replacement is never an alternate expected peer state. */
export function tempoWriteIntentsMatch(
    document: Readonly<Record<string, unknown>>,
    metadata: readonly TempoWriteIntent[],
    slot: Slot
): boolean {
    const current = new Map<string | null, number>();
    for (const intent of metadata) {
        const sourceContext = normalizeTempoSourceOwnerContext(document, intent.sourcePreservation?.ownerWitness);
        if (!sourceContext || !tempoAudioSourceCoverageMatches(sourceContext, intent.sourcePreservation?.promotion)) {
            return false;
        }
        if (
            (intent.tempoChangeId === null) !== (slot === 'transport') ||
            !Number.isFinite(intent.expectedBpm) ||
            !Number.isFinite(intent.bpm) ||
            intent.expectedBpm <= 0 ||
            intent.bpm <= 0
        ) {
            return false;
        }
        const tempo = current.get(intent.tempoChangeId) ?? rawTempo(document, intent.tempoChangeId);
        if (tempo !== intent.expectedBpm) {
            return false;
        }
        current.set(intent.tempoChangeId, intent.bpm);
    }
    return true;
}
