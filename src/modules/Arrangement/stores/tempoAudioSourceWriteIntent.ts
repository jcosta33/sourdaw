import {
    AutomergeStorageWriteConflictError,
    getCurrentAutomergeStorageMutationOwner,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    withoutDeferredTempoRecordingSources,
    type DeferredTempoRecordingSources,
} from '#/utils/deferredTempoRecordingSources';
import { type CompAudioSourceInputProof, type TempoAudioSourcePromotionSnapshot } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { tempoAudioSourceCoverageMatches } from '#/utils/tempoAudioSourceCoverage';
import {
    normalizeTempoSourceClockContext,
    normalizeTempoSourceOwnerContext,
    captureTempoSourceOwnerValue,
    readTempoSourceClockValue,
    type TempoSourceClockPath,
    type TempoSourceOwnerWitness,
} from '#/utils/tempoAudioSourcePromotion';
import { observeTempoMapRowPlan, type TempoMapRowClockWitness } from '#/utils/tempoMapRowPlan';

import { captureCompAudioSourceInputProof, type CompAudioSourceInputContext } from './compAudioSourceInputs';
import {
    captureTempoSourceFields,
    projectTempoAudioSources,
    tempoClipOptionalInputs,
    tempoClipSourceFields,
    tempoTakeSourceFields,
} from './tempoAudioSources';

type Target = { readonly tempoChangeId: string | null; readonly expectedBpm: number; readonly bpm: number };
type Dependency = { readonly clipIndex: number; readonly laneId?: string; readonly takeId?: string };
type Proof = Dependency & {
    readonly inputs: CompAudioSourceInputProof;
    readonly afterClockInputs?: CompAudioSourceInputProof;
};
type ScalarClock = { readonly target: Target; readonly clockPath?: TempoSourceClockPath };
type RowClock = { readonly rowClock: TempoMapRowClockWitness };
export type TempoAudioSourceWriteClock =
    | ScalarClock
    | {
          readonly rowClock: {
              readonly witness: TempoMapRowClockWitness;
              readonly after: { readonly transport: unknown; readonly tempoMap: unknown };
          };
      };
type SourceLaw = {
    readonly promotion: TempoAudioSourcePromotionSnapshot;
    readonly direction: 'promote' | 'restore';
} & (ScalarClock | RowClock);
export type TempoAudioSourceWriteIntent = SourceLaw & {
    readonly proofs: readonly Proof[];
    readonly ownerWitness?: TempoSourceOwnerWitness;
    readonly deferredRecordingSources?: DeferredTempoRecordingSources;
};

function locatedClip(context: CompAudioSourceInputContext, owner: TempoAudioSourcePromotionSnapshot['clips'][number]) {
    if (!isRecord(context.tracks) || !Array.isArray(context.tracks.tracks)) {
        return null;
    }
    const tracks = context.tracks.tracks.filter((row) => isRecord(row) && row.id === owner.trackId);
    const track: unknown = tracks.length === 1 ? tracks[0] : null;
    if (!isRecord(track)) {
        return null;
    }
    let rows: unknown = track.clips;
    if (owner.collection === 'active') {
        if (track.activeAlternativeId !== owner.alternativeId) {
            return null;
        }
    } else {
        if (track.activeAlternativeId === owner.alternativeId || !Array.isArray(track.alternatives)) {
            return null;
        }
        const alternatives = track.alternatives.filter((row) => isRecord(row) && row.id === owner.alternativeId);
        const alternative: unknown = alternatives.length === 1 ? alternatives[0] : null;
        rows = isRecord(alternative) ? alternative.clips : null;
    }
    if (!Array.isArray(rows)) {
        return null;
    }
    const clips = rows.filter((row) => isRecord(row) && row.id === owner.clipId);
    const clip: unknown = clips.length === 1 ? clips[0] : null;
    return isRecord(clip) && clip.type === 'audio' && clip.trackId === owner.trackId ? clip : null;
}

function locatedTake(context: CompAudioSourceInputContext, dependency: Dependency, trackId: string) {
    if (
        !dependency.laneId ||
        !dependency.takeId ||
        !isRecord(context.takeLanes) ||
        !Array.isArray(context.takeLanes.lanes)
    ) {
        return null;
    }
    const lanes = context.takeLanes.lanes.filter(
        (row) => isRecord(row) && row.id === dependency.laneId && row.trackId === trackId
    );
    const lane: unknown = lanes.length === 1 ? lanes[0] : null;
    if (!isRecord(lane) || !Array.isArray(lane.takes)) {
        return null;
    }
    const takes = lane.takes.filter((row) => isRecord(row) && row.id === dependency.takeId);
    const take: unknown = takes.length === 1 ? takes[0] : null;
    if (!isRecord(take) || typeof take.id !== 'string' || typeof take.clipId !== 'string') {
        return null;
    }
    const result: Record<string, unknown> & { id: string; clipId: string } = {
        ...take,
        id: take.id,
        clipId: take.clipId,
    };
    return result;
}

function dependencyProof(
    context: CompAudioSourceInputContext,
    intent: SourceLaw,
    dependency: Dependency
): CompAudioSourceInputProof | null {
    const owner = intent.promotion.clips[dependency.clipIndex];
    if (!owner) {
        return null;
    }
    const clock =
        'target' in intent ? normalizeTempoSourceClockContext(context, intent.target, intent.clockPath) : context;
    const clip = locatedClip(context, owner);
    if (
        !clock ||
        !clip ||
        !valuesEqual(
            {
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
                ...captureTempoSourceFields(clip, tempoClipOptionalInputs),
            },
            owner.inputs
        )
    ) {
        return null;
    }
    const from = intent.direction === 'promote' ? 'before' : 'after';
    const to = intent.direction === 'promote' ? 'after' : 'before';
    const fields = captureTempoSourceFields(clip, tempoClipSourceFields);
    if (!valuesEqual(fields, owner[from]) && !valuesEqual(fields, owner[to])) {
        return null;
    }
    const normalizedClip = { ...clip, ...owner[from] };
    for (const field of tempoClipSourceFields) {
        if (owner[from][field] === undefined) {
            delete normalizedClip[field];
        }
    }
    const sourceContext = { ...clock, tracks: { tracks: [{ id: owner.trackId, clips: [normalizedClip] }] } };
    const passOrigin = normalizedClip.audioLoopPassOriginBeat;
    let sourceStartBeat = owner.inputs.startBeat;
    let sourceEndBeat = owner.inputs.endBeat;
    if (typeof passOrigin === 'number' && Number.isFinite(passOrigin)) {
        sourceStartBeat = Math.min(sourceStartBeat, passOrigin);
        sourceEndBeat = Math.max(sourceEndBeat, passOrigin);
    }
    if (!dependency.takeId) {
        return captureCompAudioSourceInputProof(
            { trackId: owner.trackId, takes: [] },
            {
                kind: 'base',
                clipId: owner.clipId,
                startBeat: sourceStartBeat,
                endBeat: sourceEndBeat,
            },
            sourceContext
        );
    }
    return takeDependencyProof(context, intent, dependency, owner, sourceContext, sourceStartBeat, sourceEndBeat);
}

function takeDependencyProof(
    context: CompAudioSourceInputContext,
    intent: SourceLaw,
    dependency: Dependency,
    owner: TempoAudioSourcePromotionSnapshot['clips'][number],
    sourceContext: CompAudioSourceInputContext,
    sourceStartBeat: number,
    sourceEndBeat: number
): CompAudioSourceInputProof | null {
    const from = intent.direction === 'promote' ? 'before' : 'after';
    const to = intent.direction === 'promote' ? 'after' : 'before';
    if (!dependency.takeId) {
        return null;
    }
    const take = locatedTake(context, dependency, owner.trackId);
    if (!take || take.clipId !== owner.clipId) {
        return null;
    }
    const delta = intent.promotion.takes.find(
        (row) =>
            row.trackId === owner.trackId &&
            row.laneId === dependency.laneId &&
            row.takeId === dependency.takeId &&
            row.clipId === owner.clipId
    );
    let normalizedTake = take;
    if (delta) {
        const fields = captureTempoSourceFields(take, tempoTakeSourceFields);
        if (!valuesEqual(fields, delta[from]) && !valuesEqual(fields, delta[to])) {
            return null;
        }
        normalizedTake = { ...take, ...delta[from] };
        for (const field of tempoTakeSourceFields) {
            if (delta[from][field] === undefined) {
                delete normalizedTake[field];
            }
        }
    }
    const origin = normalizedTake.passOriginBeat;
    let startBeat = sourceStartBeat;
    let endBeat = sourceEndBeat;
    if (typeof origin === 'number' && Number.isFinite(origin)) {
        startBeat = Math.min(startBeat, origin);
        endBeat = Math.max(endBeat, origin);
    }
    return captureCompAudioSourceInputProof(
        { trackId: owner.trackId, takes: [normalizedTake] },
        {
            kind: 'take',
            takeId: dependency.takeId,
            startBeat,
            endBeat,
        },
        sourceContext
    );
}

/** Called only by the owning synchronous writer, after actual capture-law admission. */
export function captureTempoAudioSourceWriteIntent(
    input: {
        readonly promotion: TempoAudioSourcePromotionSnapshot;
        readonly direction: 'promote' | 'restore';
        readonly context: CompAudioSourceInputContext;
    } & TempoAudioSourceWriteClock
): TempoAudioSourceWriteIntent | null {
    let law: SourceLaw;
    let afterClock: CompAudioSourceInputContext | undefined;
    const source = { promotion: input.promotion, direction: input.direction };
    if ('target' in input) {
        if (readTempoSourceClockValue(input.context, input.target.tempoChangeId) !== input.target.expectedBpm) {
            return null;
        }
        law = { ...source, target: input.target };
        if (input.clockPath) {
            law = { ...law, clockPath: input.clockPath };
        }
    } else {
        afterClock = { ...input.context, ...input.rowClock.after };
        if (
            observeTempoMapRowPlan(input.context, input.rowClock.witness) !== 'from' ||
            observeTempoMapRowPlan(afterClock, input.rowClock.witness) !== 'to'
        ) {
            return null;
        }
        law = { ...source, rowClock: input.rowClock.witness };
    }
    const dependencies: Dependency[] = input.promotion.clips.map((_clip, clipIndex) => ({ clipIndex }));
    const takeKeys = new Set<string>();
    for (const take of [...input.promotion.takes, ...input.promotion.regions]) {
        const key = JSON.stringify([take.trackId, take.laneId, take.takeId]);
        if (takeKeys.has(key)) {
            continue;
        }
        takeKeys.add(key);
        const clipIndex = input.promotion.clips.findIndex(
            (clip) => clip.trackId === take.trackId && clip.clipId === take.clipId
        );
        if (clipIndex === -1) {
            return null;
        }
        dependencies.push({ clipIndex, laneId: take.laneId, takeId: take.takeId });
    }
    const proofs: Proof[] = [];
    for (const dependency of dependencies) {
        const inputs = dependencyProof(input.context, law, dependency);
        if (!inputs) {
            return null;
        }
        if (afterClock) {
            const afterClockInputs = dependencyProof(afterClock, law, dependency);
            if (!afterClockInputs) {
                return null;
            }
            proofs.push({ ...dependency, inputs, afterClockInputs });
        } else {
            proofs.push({ ...dependency, inputs });
        }
    }
    return structuredClone({ ...law, proofs });
}

export function tempoAudioSourceWriteIntentMatches(
    intent: TempoAudioSourceWriteIntent,
    context: CompAudioSourceInputContext
): boolean {
    const normalized = normalizeTempoSourceOwnerContext(context, intent.ownerWitness);
    if (!normalized) {
        return false;
    }
    const observation = 'rowClock' in intent ? observeTempoMapRowPlan(normalized, intent.rowClock) : 'from';
    if (!observation) {
        return false;
    }
    return intent.proofs.every((proof) =>
        valuesEqual(
            dependencyProof(normalized, intent, proof),
            observation === 'from' ? proof.inputs : proof.afterClockInputs
        )
    );
}

/** This slot has not written its own source fields yet. The alternate state
 * accepted by cross-slot proofs cannot authorize a peer stripping this slot. */
export function tempoAudioSourceTrackIntentMatches(
    intent: TempoAudioSourceWriteIntent,
    context: CompAudioSourceInputContext
): boolean {
    // The track slot has not reconciled any of this transaction's clips yet.
    // Cross-slot READ/final states cannot authorize a peer replacing raw FROM.
    if (
        intent.ownerWitness?.rows.some(
            (row) =>
                row.owner.kind === 'clip' &&
                !valuesEqual(captureTempoSourceOwnerValue(context, row.owner, row.fields), row.before)
        )
    ) {
        return false;
    }
    const normalized = normalizeTempoSourceOwnerContext(context, intent.ownerWitness);
    if (!normalized) {
        return false;
    }
    const from = intent.direction === 'promote' ? 'before' : 'after';
    if ('rowClock' in intent) {
        const coverage = withoutDeferredTempoRecordingSources(context, intent.deferredRecordingSources);
        if (!coverage || !tempoAudioSourceCoverageMatches(coverage, intent.promotion)) {
            return false;
        }
    }
    return (
        intent.promotion.clips.every((owner) => {
            const clip = locatedClip(normalized, owner);
            return clip !== null && valuesEqual(captureTempoSourceFields(clip, tempoClipSourceFields), owner[from]);
        }) && tempoAudioSourceWriteIntentMatches(intent, context)
    );
}

/** A singleton row edit has no later geometry prefix. Hydration may have
 * dropped its source fields while retaining a peer's unrelated track edits. */
export function projectTempoAudioSourceTrackWrite(
    tracks: Parameters<typeof projectTempoAudioSources>[0],
    intents: readonly TempoAudioSourceWriteIntent[]
) {
    let current = [...tracks];
    for (const intent of intents) {
        if (!('rowClock' in intent)) {
            continue;
        }
        for (const delta of intent.promotion.clips) {
            const plan: TempoAudioSourcePromotionSnapshot = {
                version: 1,
                clips: [delta],
                takes: [],
                regions: [],
                gaps: [],
                gapFieldPresence: [],
            };
            const projected = projectTempoAudioSources(current, [], plan, intent.direction);
            if (projected) {
                current = projected.tracks;
                continue;
            }
            // Authenticate an already-applied TO without publishing a reverse.
            const reverse = intent.direction === 'promote' ? 'restore' : 'promote';
            if (!projectTempoAudioSources(current, [], plan, reverse)) {
                return null;
            }
        }
    }
    return current;
}

let pendingTrackIntent:
    { readonly intent: TempoAudioSourceWriteIntent; readonly owner: object | undefined } | undefined;

export function runWithTempoAudioSourceTrackIntent<Result>(
    intent: TempoAudioSourceWriteIntent,
    callback: () => Result
): Result {
    const previous = pendingTrackIntent;
    pendingTrackIntent = { intent: structuredClone(intent), owner: getCurrentAutomergeStorageMutationOwner() };
    try {
        return callback();
    } finally {
        pendingTrackIntent = previous;
    }
}

export function captureTempoAudioSourceTrackMetadata(): readonly TempoAudioSourceWriteIntent[] | null {
    const pending = pendingTrackIntent;
    pendingTrackIntent = undefined;
    if (!pending) {
        return null;
    }
    if (pending.owner !== getCurrentAutomergeStorageMutationOwner()) {
        throw new AutomergeStorageWriteConflictError('Tempo source intent belongs to another mutation owner');
    }
    return [structuredClone(pending.intent)];
}
