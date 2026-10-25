import { digest } from '#/utils/canonicalDigest';
import { type CompAudioSourceInputProof, type CompAudioSourceOwnerSnapshot } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';

import { type TakeLane } from '../models/TakeLane';

export type CompAudioSourceInputContext = Readonly<Record<string, unknown>>;

const clipFields = [
    'id',
    'trackId',
    'type',
    'audioBufferId',
    'startBeat',
    'endBeat',
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'loopOriginBeat',
    'loopEnabled',
    'loopLength',
    'stretchMode',
    'stretchRatio',
] as const;
const takeFields = [
    'id',
    'clipId',
    'startBeat',
    'endBeat',
    'sourceOffsetBeats',
    'sourceOffsetSeconds',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
    'passOriginBeat',
    'passOriginSourceSeconds',
] as const;

function pick(value: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(
        fields
            .filter((field) => Object.hasOwn(value, field) && value[field] !== undefined)
            .map((field) => [field, value[field]])
    );
}

function mediaIdentity(clip: Record<string, unknown>): CompAudioSourceInputProof['media'] | null {
    if (
        (clip.audioBufferId !== undefined && typeof clip.audioBufferId !== 'string') ||
        (clip.assetHash !== undefined && typeof clip.assetHash !== 'string')
    )
        return null;
    return {
        ...(typeof clip.audioBufferId === 'string' ? { audioBufferId: clip.audioBufferId } : {}),
        ...(typeof clip.assetHash === 'string' ? { assetHash: clip.assetHash } : {}),
    };
}

function sourceOwner(lane: TakeLane, owner: CompAudioSourceOwnerSnapshot, context: CompAudioSourceInputContext) {
    const take = owner.kind === 'take' ? lane.takes.find((candidate) => candidate.id === owner.takeId) : undefined;
    const clipId = owner.kind === 'base' ? owner.clipId : take?.clipId;
    if (!clipId || !isRecord(context.tracks) || !Array.isArray(context.tracks.tracks)) return null;
    const track = context.tracks.tracks.find((candidate) => isRecord(candidate) && candidate.id === lane.trackId);
    if (!isRecord(track) || !Array.isArray(track.clips)) return null;
    const clip = track.clips.find((candidate) => isRecord(candidate) && candidate.id === clipId);
    if (
        !isRecord(clip) ||
        clip.type !== 'audio' ||
        clip.trackId !== lane.trackId ||
        typeof clip.startBeat !== 'number' ||
        !Number.isFinite(clip.startBeat)
    )
        return null;
    return { clip: { ...clip, startBeat: clip.startBeat }, take };
}

type Change = { readonly beat: number; readonly tempo: number; readonly curve: 'instant' | 'linear' };
function isChange(value: unknown): value is Change {
    return (
        isRecord(value) &&
        typeof value.beat === 'number' &&
        Number.isFinite(value.beat) &&
        value.beat >= 0 &&
        typeof value.tempo === 'number' &&
        Number.isFinite(value.tempo) &&
        value.tempo > 0 &&
        (value.curve === 'instant' || value.curve === 'linear')
    );
}

/** Only events governing this original source span participate. UI fields,
 * unrelated clips and later tempo events do not acquire source ownership. */
function sourceDigest(
    lane: TakeLane,
    owner: CompAudioSourceOwnerSnapshot,
    proof: Pick<CompAudioSourceInputProof, 'clipId' | 'startBeat' | 'endBeat'>,
    context: CompAudioSourceInputContext
): string | null {
    const source = sourceOwner(lane, owner, context);
    if (!source || source.clip.id !== proof.clipId) return null;
    const rawChanges = isRecord(context.tempoMap) ? context.tempoMap.changes : [];
    if (!Array.isArray(rawChanges) || !rawChanges.every(isChange)) return null;
    const changes = [...rawChanges].sort((a, b) => a.beat - b.beat);
    const previous = changes.findLastIndex((change) => change.beat <= proof.startBeat);
    let end = changes.findIndex((change) => change.beat > proof.endBeat);
    if (end === -1) end = changes.length;
    if (end > 0 && changes[end - 1]?.curve === 'linear' && end < changes.length) end += 1;
    const tempo =
        isRecord(context.transport) && typeof context.transport.tempo === 'number'
            ? context.transport.tempo
            : DEFAULT_TEMPO_BPM;
    if (!Number.isFinite(tempo) || tempo <= 0) return null;
    return digest({
        clip: pick(source.clip, clipFields),
        take: source.take ? pick(source.take, takeFields) : null,
        defaultTempo: previous === -1 ? tempo : null,
        changes: changes.slice(Math.max(previous, 0), end).map(({ beat, tempo, curve }) => ({ beat, tempo, curve })),
    });
}

export function captureCompAudioSourceInputProof(
    lane: TakeLane,
    owner: CompAudioSourceOwnerSnapshot,
    context: CompAudioSourceInputContext
): CompAudioSourceInputProof | null {
    const source = sourceOwner(lane, owner, context);
    if (!source) return null;
    const range = {
        clipId: String(source.clip.id),
        startBeat: Math.min(source.clip.startBeat, owner.startBeat),
        endBeat: Math.max(source.clip.startBeat, owner.endBeat),
    };
    const hash = sourceDigest(lane, owner, range, context);
    const media = mediaIdentity(source.clip);
    return hash && media ? { ...range, digest: hash, media } : null;
}

export function compAudioSourceInputsMatch(
    lane: TakeLane,
    owner: CompAudioSourceOwnerSnapshot,
    proof: CompAudioSourceInputProof | undefined,
    context: CompAudioSourceInputContext | undefined
): boolean {
    return proof !== undefined && context !== undefined && sourceDigest(lane, owner, proof, context) === proof.digest;
}

export function compAudioSourceOwnerExists(
    lane: TakeLane,
    owner: CompAudioSourceOwnerSnapshot,
    proof: CompAudioSourceInputProof,
    context: CompAudioSourceInputContext
): boolean {
    const source = sourceOwner(lane, owner, context);
    if (!source || source.clip.id !== proof.clipId || !valuesEqual(mediaIdentity(source.clip), proof.media))
        return false;
    return (
        owner.kind !== 'base' ||
        (source.clip.startBeat <= owner.startBeat &&
            typeof source.clip.endBeat === 'number' &&
            source.clip.endBeat >= owner.endBeat)
    );
}

function isMediaIdentity(value: unknown): value is CompAudioSourceInputProof['media'] {
    return (
        isRecord(value) &&
        Object.keys(value).every(
            (key) => ['audioBufferId', 'assetHash'].includes(key) && typeof value[key] === 'string'
        )
    );
}

export function isCompAudioSourceInputProof(value: unknown): value is CompAudioSourceInputProof {
    return (
        isRecord(value) &&
        Object.keys(value).length === 5 &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat &&
        typeof value.digest === 'string' &&
        /^[a-f0-9]{64}$/.test(value.digest) &&
        isMediaIdentity(value.media)
    );
}
