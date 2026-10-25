import {
    AutomergeStorageWriteConflictError,
    getCurrentAutomergeStorageMutationOwner,
} from '#/infra/store/storage/createAutomergeStorage';
import { type CompAudioSourceInputProof, type TempoAudioSourcePromotionSnapshot } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { captureCompAudioSourceInputProof, type CompAudioSourceInputContext } from './compAudioSourceInputs';
import {
    captureTempoSourceFields,
    tempoClipOptionalInputs,
    tempoClipSourceFields,
    tempoTakeSourceFields,
} from './tempoAudioSources';

type Target = { readonly tempoChangeId: string | null; readonly expectedBpm: number; readonly bpm: number };
type Dependency = { readonly clipIndex: number; readonly laneId?: string; readonly takeId?: string };
type Proof = Dependency & { readonly inputs: CompAudioSourceInputProof };
export type TempoAudioSourceWriteIntent = {
    readonly promotion: TempoAudioSourcePromotionSnapshot;
    readonly direction: 'promote' | 'restore';
    readonly target: Target;
    readonly proofs: readonly Proof[];
};

function targetTempo(context: CompAudioSourceInputContext, target: Target): number | null {
    if (target.tempoChangeId === null) {
        const tempo = isRecord(context.transport) ? context.transport.tempo : null;
        return typeof tempo === 'number' && Number.isFinite(tempo) ? tempo : null;
    }
    const changes = isRecord(context.tempoMap) ? context.tempoMap.changes : undefined;
    if (!Array.isArray(changes)) {
        return null;
    }
    const matches = changes.filter((row) => isRecord(row) && row.id === target.tempoChangeId);
    const row: unknown = matches.length === 1 ? matches[0] : null;
    return isRecord(row) && typeof row.tempo === 'number' && Number.isFinite(row.tempo) ? row.tempo : null;
}

/** A sibling slot may already contain this same action's target write. Only
 * its two exact values normalize; unrelated current map data remains live. */
function sourceClockContext(context: CompAudioSourceInputContext, target: Target): CompAudioSourceInputContext | null {
    const tempo = targetTempo(context, target);
    if (tempo !== target.expectedBpm && tempo !== target.bpm) {
        return null;
    }
    if (target.tempoChangeId === null) {
        if (context.transport !== undefined && context.transport !== null && !isRecord(context.transport)) {
            return null;
        }
        const transport = isRecord(context.transport) ? context.transport : {};
        return { ...context, transport: { ...transport, tempo: target.expectedBpm } };
    }
    if (!isRecord(context.tempoMap) || !Array.isArray(context.tempoMap.changes)) {
        return null;
    }
    const changes = context.tempoMap.changes.map((row: unknown) => {
        if (isRecord(row) && row.id === target.tempoChangeId) {
            return { ...row, tempo: target.expectedBpm };
        }
        return row;
    });
    return { ...context, tempoMap: { ...context.tempoMap, changes } };
}

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
    intent: Pick<TempoAudioSourceWriteIntent, 'promotion' | 'direction' | 'target'>,
    dependency: Dependency
): CompAudioSourceInputProof | null {
    const owner = intent.promotion.clips[dependency.clipIndex];
    if (!owner) {
        return null;
    }
    const clock = sourceClockContext(context, intent.target);
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
export function captureTempoAudioSourceWriteIntent(input: {
    readonly promotion: TempoAudioSourcePromotionSnapshot;
    readonly direction: 'promote' | 'restore';
    readonly target: Target;
    readonly context: CompAudioSourceInputContext;
}): TempoAudioSourceWriteIntent | null {
    if (targetTempo(input.context, input.target) !== input.target.expectedBpm) {
        return null;
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
        const inputs = dependencyProof(input.context, input, dependency);
        if (!inputs) {
            return null;
        }
        proofs.push({ ...dependency, inputs });
    }
    return {
        promotion: structuredClone(input.promotion),
        direction: input.direction,
        target: structuredClone(input.target),
        proofs,
    };
}

export function tempoAudioSourceWriteIntentMatches(
    intent: TempoAudioSourceWriteIntent,
    context: CompAudioSourceInputContext
): boolean {
    return intent.proofs.every((proof) => valuesEqual(dependencyProof(context, intent, proof), proof.inputs));
}

/** This slot has not written its own source fields yet. The alternate state
 * accepted by cross-slot proofs cannot authorize a peer stripping this slot. */
export function tempoAudioSourceTrackIntentMatches(
    intent: TempoAudioSourceWriteIntent,
    context: CompAudioSourceInputContext
): boolean {
    const from = intent.direction === 'promote' ? 'before' : 'after';
    return (
        intent.promotion.clips.every((owner) => {
            const clip = locatedClip(context, owner);
            return clip !== null && valuesEqual(captureTempoSourceFields(clip, tempoClipSourceFields), owner[from]);
        }) && tempoAudioSourceWriteIntentMatches(intent, context)
    );
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
