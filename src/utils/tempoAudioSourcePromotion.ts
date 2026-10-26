import {
    captureAudioSourceState,
    hasValidAudioPassOrigin,
    hasValidAudioSourceState,
    isAudioSourceSnapshot,
} from './audioSourceTime';
import { projectClipLoopExpansion } from './clipLoopProjection';
import {
    type TempoAudioClipFieldsSnapshot,
    type TempoAudioClipInputsSnapshot,
    type TempoAudioSourcePresenceSnapshot,
    type TempoAudioSourcePromotionSnapshot,
    type TempoAudioTakeFieldsSnapshot,
    type TempoAudioTakeInputsSnapshot,
} from './handlerContract';
import { isRecord, valuesEqual } from './structuralEquality';
import { type TempoMapRow } from './tempoMapRowPlan';

export type TempoSourceClock = {
    readonly tempo: number;
    readonly changes: readonly TempoMapRow[];
};

export type TempoScalarTransition = {
    readonly tempoChangeId: string | null;
    readonly expectedBpm: number;
    readonly bpm: number;
};

export type TempoSourceClockPath = {
    readonly transitions: readonly TempoScalarTransition[];
    readonly before: readonly { readonly tempoChangeId: string | null; readonly tempo: number }[];
};

type RawClock = { readonly transport?: unknown; readonly tempoMap?: unknown };

export type TempoSourceOwner =
    | {
          readonly kind: 'clip';
          readonly trackId: string;
          readonly collection: 'active' | 'alternative';
          readonly alternativeId: string;
          readonly clipId: string;
      }
    | { readonly kind: 'take'; readonly trackId: string; readonly laneId: string; readonly takeId: string }
    | {
          readonly kind: 'region';
          readonly trackId: string;
          readonly laneId: string;
          readonly takeId: string;
          readonly startBeat: number;
          readonly endBeat: number;
      }
    | {
          readonly kind: 'gap';
          readonly trackId: string;
          readonly laneId: string;
          readonly clipId: string;
          readonly startBeat: number;
          readonly endBeat: number;
      };
type SourceOwnerValue =
    { readonly present: false } | { readonly present: true; readonly value: Readonly<Record<string, unknown>> };
export type TempoSourceOwnerWitness = {
    readonly rows: readonly {
        readonly owner: TempoSourceOwner;
        readonly fields: readonly string[];
        readonly before: SourceOwnerValue;
        readonly read: SourceOwnerValue;
        readonly after: SourceOwnerValue;
    }[];
};
type RawSources = { readonly tracks?: unknown; readonly takeLanes?: unknown };

type TempoSourceLaneOwner = Exclude<TempoSourceOwner, { readonly kind: 'clip' }>;

function sourceLaneField(owner: TempoSourceLaneOwner): 'takes' | 'activeCompRegions' | 'baseGapAudioSources' {
    if (owner.kind === 'take') {
        return 'takes';
    }
    if (owner.kind === 'region') {
        return 'activeCompRegions';
    }
    return 'baseGapAudioSources';
}

function sourceRows(context: RawSources, owner: TempoSourceOwner): readonly unknown[] | null {
    if (owner.kind === 'clip') {
        if (!isRecord(context.tracks) || !Array.isArray(context.tracks.tracks)) {
            return null;
        }
        const tracks = context.tracks.tracks.filter((row) => isRecord(row) && row.id === owner.trackId);
        const track: unknown = tracks.length === 1 ? tracks[0] : null;
        if (!isRecord(track)) {
            return null;
        }
        if (owner.collection === 'active') {
            return track.activeAlternativeId === owner.alternativeId && Array.isArray(track.clips) ? track.clips : null;
        }
        if (track.activeAlternativeId === owner.alternativeId || !Array.isArray(track.alternatives)) {
            return null;
        }
        const alternatives = track.alternatives.filter((row) => isRecord(row) && row.id === owner.alternativeId);
        const alternative: unknown = alternatives.length === 1 ? alternatives[0] : null;
        return isRecord(alternative) && Array.isArray(alternative.clips) ? alternative.clips : null;
    }
    if (!isRecord(context.takeLanes) || !Array.isArray(context.takeLanes.lanes)) {
        return null;
    }
    const lanes = context.takeLanes.lanes.filter(
        (row) => isRecord(row) && row.id === owner.laneId && row.trackId === owner.trackId
    );
    const lane: unknown = lanes.length === 1 ? lanes[0] : null;
    if (!isRecord(lane)) {
        return null;
    }
    const field = sourceLaneField(owner);
    if (owner.kind === 'gap' && !Object.hasOwn(lane, field)) {
        return [];
    }
    return Array.isArray(lane[field]) ? lane[field] : null;
}

function isSourceOwnerRow(row: unknown, owner: TempoSourceOwner): boolean {
    if (!isRecord(row)) {
        return false;
    }
    if (owner.kind === 'clip') {
        return row.id === owner.clipId;
    }
    if (owner.kind === 'take') {
        return row.id === owner.takeId;
    }
    const member = owner.kind === 'region' ? row.takeId === owner.takeId : row.clipId === owner.clipId;
    return member && row.startBeat === owner.startBeat && row.endBeat === owner.endBeat;
}

/** Undefined is invalid location/ambiguity; null is an authenticated absent row. */
export function readTempoSourceOwner(
    context: RawSources,
    owner: TempoSourceOwner
): Readonly<Record<string, unknown>> | null | undefined {
    const rows = sourceRows(context, owner);
    if (!rows) {
        return undefined;
    }
    const matches = rows.filter((row) => isSourceOwnerRow(row, owner));
    if (matches.length === 0) {
        return null;
    }
    return matches.length === 1 && isRecord(matches[0]) ? matches[0] : undefined;
}

export function captureTempoSourceOwnerValue(
    context: RawSources,
    owner: TempoSourceOwner,
    fields: readonly string[]
): SourceOwnerValue | null {
    const row = readTempoSourceOwner(context, owner);
    if (row === undefined) {
        return null;
    }
    if (row === null) {
        return { present: false };
    }
    try {
        const value: unknown = JSON.parse(
            JSON.stringify(
                Object.fromEntries(
                    fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]])
                )
            )
        );
        return isRecord(value) ? { present: true, value } : null;
    } catch {
        return null;
    }
}

export function tempoSourceOwnerWitnessMatches(
    context: RawSources,
    witness: TempoSourceOwnerWitness,
    side: 'before' | 'read' | 'after'
): boolean {
    return witness.rows.every((row) =>
        valuesEqual(captureTempoSourceOwnerValue(context, row.owner, row.fields), row[side])
    );
}

function replaceSourceOwner<Context extends RawSources>(
    context: Context,
    owner: TempoSourceOwner,
    fields: readonly string[],
    target: SourceOwnerValue
): Context | null {
    const rows = sourceRows(context, owner);
    if (!rows) {
        return null;
    }
    const old = readTempoSourceOwner(context, owner);
    if (old === undefined) {
        return null;
    }
    const replacement: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(old ?? {})) {
        if (!fields.includes(field)) {
            replacement[field] = value;
        }
    }
    if (target.present) {
        Object.assign(replacement, target.value);
    }
    const existingIndex = rows.findIndex((row) => isSourceOwnerRow(row, owner));
    const nextRows = [...rows];
    if (existingIndex >= 0) {
        if (target.present) {
            nextRows.splice(existingIndex, 1, replacement);
        } else {
            nextRows.splice(existingIndex, 1);
        }
    } else if (target.present) {
        // A re-key may remove this owner before another slot reads its old
        // programme. Reinsert only that captured interval in the same ordered
        // law the region/tile writers use; never reorder unrelated raw rows.
        let insertionIndex = -1;
        if (owner.kind === 'region' || owner.kind === 'gap') {
            insertionIndex = nextRows.findIndex(
                (row) =>
                    isRecord(row) &&
                    (owner.kind === 'region' || row.clipId === owner.clipId) &&
                    typeof row.startBeat === 'number' &&
                    row.startBeat > owner.startBeat
            );
        }
        nextRows.splice(insertionIndex < 0 ? nextRows.length : insertionIndex, 0, replacement);
    }
    if (owner.kind === 'clip') {
        const slot = context.tracks;
        if (!isRecord(slot) || !Array.isArray(slot.tracks)) {
            return null;
        }
        const tracks = slot.tracks.map((track: unknown) => {
            if (!isRecord(track) || track.id !== owner.trackId) {
                return track;
            }
            if (owner.collection === 'active') {
                return { ...track, clips: nextRows };
            }
            if (!Array.isArray(track.alternatives)) {
                return track;
            }
            return {
                ...track,
                alternatives: track.alternatives.map((alternative: unknown) => {
                    if (isRecord(alternative) && alternative.id === owner.alternativeId) {
                        return { ...alternative, clips: nextRows };
                    }
                    return alternative;
                }),
            };
        });
        return { ...context, tracks: { ...slot, tracks } };
    }
    const slot = context.takeLanes;
    if (!isRecord(slot) || !Array.isArray(slot.lanes)) {
        return null;
    }
    const field = sourceLaneField(owner);
    return {
        ...context,
        takeLanes: {
            ...slot,
            lanes: slot.lanes.map((lane: unknown) => {
                if (isRecord(lane) && lane.id === owner.laneId && lane.trackId === owner.trackId) {
                    return { ...lane, [field]: nextRows };
                }
                return lane;
            }),
        },
    };
}

/** Value-only source-input projection. Raw FROM is checked separately before
 * any slot write; only the exact captured programme states can normalize. */
export function normalizeTempoSourceOwnerContext<Context extends RawSources>(
    context: Context,
    witness?: TempoSourceOwnerWitness
): Context | null {
    if (!witness) {
        return context;
    }
    let result = context;
    for (const row of witness.rows) {
        const actual = captureTempoSourceOwnerValue(context, row.owner, row.fields);
        if (![row.before, row.read, row.after].some((value) => valuesEqual(actual, value))) {
            return null;
        }
        const next = replaceSourceOwner(result, row.owner, row.fields, row.read);
        if (!next) {
            return null;
        }
        result = next;
    }
    return result;
}

export function readTempoSourceClockValue(context: RawClock, tempoChangeId: string | null): number | null {
    if (tempoChangeId === null) {
        const tempo = isRecord(context.transport) ? context.transport.tempo : null;
        return typeof tempo === 'number' && Number.isFinite(tempo) && tempo > 0 ? tempo : null;
    }
    const changes = isRecord(context.tempoMap) ? context.tempoMap.changes : null;
    if (!Array.isArray(changes)) {
        return null;
    }
    const rows = changes.filter((row) => isRecord(row) && row.id === tempoChangeId);
    const row: unknown = rows.length === 1 ? rows[0] : null;
    return isRecord(row) && typeof row.tempo === 'number' && Number.isFinite(row.tempo) && row.tempo > 0
        ? row.tempo
        : null;
}

function withRawTempo<Context extends RawClock>(
    context: Context,
    tempoChangeId: string | null,
    tempo: number
): Context | null {
    if (tempoChangeId === null) {
        return isRecord(context.transport) ? { ...context, transport: { ...context.transport, tempo } } : null;
    }
    if (!isRecord(context.tempoMap) || !Array.isArray(context.tempoMap.changes)) {
        return null;
    }
    return {
        ...context,
        tempoMap: {
            ...context.tempoMap,
            changes: context.tempoMap.changes.map((row: unknown) =>
                isRecord(row) && row.id === tempoChangeId ? { ...row, tempo } : row
            ),
        },
    };
}

/** Cross-slot source proofs may observe an owned clock slot before or after
 * its ordered writes. Scalar metadata independently authenticates raw FROM;
 * normalization never authorizes a replacement merely because it equals TO. */
export function normalizeTempoSourceClockContext<Context extends RawClock>(
    context: Context,
    target: TempoScalarTransition,
    path?: TempoSourceClockPath
): Context | null {
    if (!path) {
        const tempo = readTempoSourceClockValue(context, target.tempoChangeId);
        if (tempo === target.expectedBpm || tempo === target.bpm) {
            return withRawTempo(context, target.tempoChangeId, target.expectedBpm);
        }
        return null;
    }
    const values = new Map<string | null, number[]>();
    for (const transition of path.transitions) {
        if (![transition.expectedBpm, transition.bpm].every((tempo) => Number.isFinite(tempo) && tempo > 0)) {
            return null;
        }
        const prior = values.get(transition.tempoChangeId);
        if (prior && prior[prior.length - 1] !== transition.expectedBpm) {
            return null;
        }
        const sequence = prior ? prior.slice() : [transition.expectedBpm];
        sequence.push(transition.bpm);
        values.set(transition.tempoChangeId, sequence);
    }
    if (
        path.before.length !== values.size ||
        new Set(path.before.map((row) => row.tempoChangeId)).size !== values.size
    ) {
        return null;
    }
    if (
        !path.transitions.some((row) => valuesEqual(row, target)) ||
        path.before.find((row) => row.tempoChangeId === target.tempoChangeId)?.tempo !== target.expectedBpm
    ) {
        return null;
    }
    let normalized = context;
    for (const before of path.before) {
        const allowed = values.get(before.tempoChangeId);
        const actual = readTempoSourceClockValue(context, before.tempoChangeId);
        if (!allowed || actual === null || !allowed.includes(actual) || !allowed.includes(before.tempo)) {
            return null;
        }
        const next = withRawTempo(normalized, before.tempoChangeId, before.tempo);
        if (!next) {
            return null;
        }
        normalized = next;
    }
    return normalized;
}

export function tempoSourcePromotionsEqual(
    actual: TempoAudioSourcePromotionSnapshot,
    expected: TempoAudioSourcePromotionSnapshot
): boolean {
    return (['clips', 'takes', 'regions', 'gaps'] as const).every(
        (field) =>
            actual[field].length === expected[field].length &&
            expected[field].every((row) => actual[field].some((candidate) => valuesEqual(candidate, row)))
    );
}

/** An ordered scalar prefix changes only its actual named rows or base value. */
export function projectTempoSourceClock(
    clock: TempoSourceClock,
    transitions: readonly TempoScalarTransition[]
): TempoSourceClock | null {
    let result = clock;
    for (const transition of transitions) {
        if (!Number.isFinite(transition.bpm) || transition.bpm <= 0) {
            return null;
        }
        if (transition.tempoChangeId === null) {
            if (result.tempo !== transition.expectedBpm) {
                return null;
            }
            result = { ...result, tempo: transition.bpm };
            continue;
        }
        const matches = result.changes.filter((row) => row.id === transition.tempoChangeId);
        if (matches.length !== 1 || matches[0]!.tempo !== transition.expectedBpm) {
            return null;
        }
        result = {
            ...result,
            changes: result.changes.map((row) =>
                row.id === transition.tempoChangeId ? { ...row, tempo: transition.bpm } : row
            ),
        };
    }
    return result;
}

type ClipDelta = TempoAudioSourcePromotionSnapshot['clips'][number];
type TakeDelta = TempoAudioSourcePromotionSnapshot['takes'][number];
type RegionDelta = TempoAudioSourcePromotionSnapshot['regions'][number];
type GapDelta = TempoAudioSourcePromotionSnapshot['gaps'][number];

function exactKeys(
    value: unknown,
    required: readonly string[],
    optional: readonly string[] = []
): value is Record<string, unknown> {
    return (
        isRecord(value) &&
        required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
    );
}
function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
function id(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
function optionalNumbers(value: Record<string, unknown>, fields: readonly string[]): boolean {
    return fields.every((field) => !Object.hasOwn(value, field) || finite(value[field]));
}
function optionalType(value: Record<string, unknown>, field: string, type: 'string' | 'boolean'): boolean {
    return !Object.hasOwn(value, field) || typeof value[field] === type;
}
function range(value: Record<string, unknown>, empty = false): boolean {
    return (
        finite(value.startBeat) &&
        value.startBeat >= 0 &&
        finite(value.endBeat) &&
        (empty ? value.endBeat >= value.startBeat : value.endBeat > value.startBeat)
    );
}
function clipFields(value: unknown): value is TempoAudioClipFieldsSnapshot {
    return (
        exactKeys(
            value,
            [],
            [
                'audioOffsetSeconds',
                'audioUnwrappedOffsetSeconds',
                'audioLoopStartSeconds',
                'audioLoopPassEntrySeconds',
                'audioLoopPassOriginBeat',
            ]
        ) &&
        optionalNumbers(value, [
            'audioOffsetSeconds',
            'audioUnwrappedOffsetSeconds',
            'audioLoopStartSeconds',
            'audioLoopPassEntrySeconds',
            'audioLoopPassOriginBeat',
        ]) &&
        hasValidAudioSourceState(value)
    );
}
function clipInputs(value: unknown): value is TempoAudioClipInputsSnapshot {
    return (
        exactKeys(
            value,
            ['startBeat', 'endBeat'],
            [
                'audioBufferId',
                'assetHash',
                'audioOffsetBeats',
                'loopEnabled',
                'loopLength',
                'loopOriginBeat',
                'stretchMode',
                'stretchRatio',
            ]
        ) &&
        range(value, true) &&
        optionalNumbers(value, ['audioOffsetBeats', 'loopLength', 'loopOriginBeat', 'stretchRatio']) &&
        optionalType(value, 'audioBufferId', 'string') &&
        optionalType(value, 'assetHash', 'string') &&
        optionalType(value, 'loopEnabled', 'boolean') &&
        (!Object.hasOwn(value, 'stretchMode') ||
            (typeof value.stretchMode === 'string' && ['off', 'repitch', 'timestretch'].includes(value.stretchMode)))
    );
}
function clipDelta(value: unknown): value is ClipDelta {
    if (
        !exactKeys(value, ['trackId', 'collection', 'alternativeId', 'clipId', 'inputs', 'before', 'after']) ||
        !id(value.trackId) ||
        !id(value.alternativeId) ||
        !id(value.clipId) ||
        (value.collection !== 'active' && value.collection !== 'alternative') ||
        !clipInputs(value.inputs) ||
        !clipFields(value.before) ||
        !clipFields(value.after) ||
        !finite(value.after.audioOffsetSeconds) ||
        !finite(value.after.audioUnwrappedOffsetSeconds)
    ) {
        return false;
    }
    if (
        value.inputs.loopEnabled &&
        (!finite(value.after.audioLoopStartSeconds) ||
            !finite(value.after.audioLoopPassEntrySeconds) ||
            !finite(value.after.audioLoopPassOriginBeat))
    ) {
        return false;
    }
    if (value.before.audioOffsetSeconds !== undefined) {
        const loop = projectClipLoopExpansion({
            clipDurationBeats: value.inputs.endBeat - value.inputs.startBeat,
            configuredLoopLengthBeats: value.inputs.loopLength,
            loopEnabled: value.inputs.loopEnabled ?? false,
        });
        // A canonical record never reads this legacy conversion tempo.
        const expected = captureAudioSourceState({ ...value.inputs, ...value.before }, loop.loopLengthBeats, 120);
        if (!valuesEqual(expected, value.after)) {
            return false;
        }
    }
    return true;
}
function takeInputs(value: unknown): value is TempoAudioTakeInputsSnapshot {
    if (
        !exactKeys(
            value,
            ['startBeat', 'endBeat'],
            ['sourceOffsetBeats', 'passAnchorSeconds', 'passDepthSeconds', 'passSourceEndSeconds']
        ) ||
        !range(value, true) ||
        !optionalNumbers(value, ['sourceOffsetBeats', 'passAnchorSeconds', 'passDepthSeconds', 'passSourceEndSeconds'])
    ) {
        return false;
    }
    if (finite(value.sourceOffsetBeats) && value.sourceOffsetBeats < 0) {
        return false;
    }
    if (value.passAnchorSeconds === undefined && value.passDepthSeconds === undefined) {
        return value.passSourceEndSeconds === undefined;
    }
    return (
        finite(value.sourceOffsetBeats) &&
        finite(value.passAnchorSeconds) &&
        finite(value.passDepthSeconds) &&
        value.passDepthSeconds >= 0 &&
        (value.passSourceEndSeconds === undefined ||
            (finite(value.passSourceEndSeconds) && value.passSourceEndSeconds > value.passDepthSeconds))
    );
}
function takeFields(value: unknown, inputs: TempoAudioTakeInputsSnapshot): value is TempoAudioTakeFieldsSnapshot {
    return (
        exactKeys(value, [], ['sourceOffsetSeconds', 'passOriginBeat', 'passOriginSourceSeconds']) &&
        optionalNumbers(value, ['sourceOffsetSeconds', 'passOriginBeat', 'passOriginSourceSeconds']) &&
        (value.sourceOffsetSeconds === undefined ||
            (finite(value.sourceOffsetSeconds) && value.sourceOffsetSeconds >= 0)) &&
        hasValidAudioPassOrigin({ ...inputs, ...value })
    );
}
function takeDelta(value: unknown): value is TakeDelta {
    if (
        !exactKeys(value, ['trackId', 'laneId', 'takeId', 'clipId', 'inputs', 'before', 'after']) ||
        !id(value.trackId) ||
        !id(value.laneId) ||
        !id(value.takeId) ||
        !id(value.clipId) ||
        !takeInputs(value.inputs) ||
        !takeFields(value.before, value.inputs) ||
        !takeFields(value.after, value.inputs) ||
        valuesEqual(value.before, value.after)
    ) {
        return false;
    }
    if (value.before.sourceOffsetSeconds !== undefined) {
        if (value.after.sourceOffsetSeconds !== value.before.sourceOffsetSeconds) {
            return false;
        }
    } else if (value.inputs.sourceOffsetBeats !== undefined) {
        if (
            !finite(value.after.sourceOffsetSeconds) ||
            (value.inputs.sourceOffsetBeats === 0 && value.after.sourceOffsetSeconds !== 0)
        ) {
            return false;
        }
    } else if (value.after.sourceOffsetSeconds !== undefined) {
        return false;
    }
    if (
        value.before.passOriginBeat !== undefined &&
        (value.after.passOriginBeat !== value.before.passOriginBeat ||
            value.after.passOriginSourceSeconds !== value.before.passOriginSourceSeconds)
    ) {
        return false;
    }
    return (
        value.inputs.passAnchorSeconds === undefined ||
        (finite(value.after.passOriginBeat) && finite(value.after.passOriginSourceSeconds))
    );
}
function presence(value: unknown): value is TempoAudioSourcePresenceSnapshot {
    if (exactKeys(value, ['present']) && value.present === false) {
        return true;
    }
    return exactKeys(value, ['present', 'value']) && value.present === true && isAudioSourceSnapshot(value.value);
}
function sourceDelta(value: unknown, selected: true): value is RegionDelta;
function sourceDelta(value: unknown, selected: false): value is GapDelta;
function sourceDelta(value: unknown, selected: boolean): value is RegionDelta | GapDelta {
    const required = ['trackId', 'laneId', 'clipId', 'startBeat', 'endBeat', 'before', 'after'];
    if (selected) {
        required.push('takeId');
    }
    return (
        exactKeys(value, required) &&
        id(value.trackId) &&
        id(value.laneId) &&
        id(value.clipId) &&
        (!selected || id(value.takeId)) &&
        range(value) &&
        presence(value.before) &&
        presence(value.after) &&
        value.before.present === false &&
        value.after.present === true
    );
}

/** Decode value shape and member coherence only. This grants no source-write authority:
 * the Arrangement owner must reproduce the capture law against the actual project. */
export function isTempoAudioSourcePromotion(value: unknown): value is TempoAudioSourcePromotionSnapshot {
    if (
        !exactKeys(value, ['version', 'clips', 'takes', 'regions', 'gaps', 'gapFieldPresence']) ||
        value.version !== 1
    ) {
        return false;
    }
    const { clips, takes, regions, gaps, gapFieldPresence } = value;
    if (
        !Array.isArray(clips) ||
        !clips.every(clipDelta) ||
        !Array.isArray(takes) ||
        !takes.every(takeDelta) ||
        !Array.isArray(regions) ||
        !regions.every((row): row is RegionDelta => sourceDelta(row, true)) ||
        !Array.isArray(gaps) ||
        !gaps.every((row): row is GapDelta => sourceDelta(row, false)) ||
        !Array.isArray(gapFieldPresence)
    ) {
        return false;
    }
    const clipKeys = new Set<string>();
    const activeAlternatives = new Map<string, string>();
    for (const clip of clips) {
        const key = JSON.stringify([clip.trackId, clip.collection, clip.alternativeId, clip.clipId]);
        if (clipKeys.has(key)) {
            return false;
        }
        clipKeys.add(key);
        if (clip.collection === 'active') {
            const previous = activeAlternatives.get(clip.trackId);
            if (previous !== undefined && previous !== clip.alternativeId) {
                return false;
            }
            activeAlternatives.set(clip.trackId, clip.alternativeId);
        }
    }
    if (
        clips.some(
            (clip) => clip.collection === 'alternative' && activeAlternatives.get(clip.trackId) === clip.alternativeId
        )
    ) {
        return false;
    }
    const takeIds = new Set<string>();
    const laneOwners = new Map<string, string>();
    for (const row of [...takes, ...regions, ...gaps]) {
        const matchingClips = clips.filter((clip) => clip.trackId === row.trackId && clip.clipId === row.clipId);
        if (matchingClips.length !== 1 || (laneOwners.has(row.laneId) && laneOwners.get(row.laneId) !== row.trackId)) {
            return false;
        }
        laneOwners.set(row.laneId, row.trackId);
    }
    for (const take of takes) {
        if (takeIds.has(take.takeId)) {
            return false;
        }
        takeIds.add(take.takeId);
        const clip = clips.find((row) => row.trackId === take.trackId && row.clipId === take.clipId);
        if (
            !clip ||
            (take.before.passOriginBeat === undefined &&
                take.after.passOriginBeat !== undefined &&
                (take.after.passOriginBeat !== clip.inputs.startBeat ||
                    take.after.passOriginSourceSeconds !== clip.after.audioUnwrappedOffsetSeconds))
        ) {
            return false;
        }
    }
    for (const region of regions) {
        const take = takes.find((row) => row.takeId === region.takeId);
        const clip = clips.find((row) => row.trackId === region.trackId && row.clipId === region.clipId);
        if (
            !clip ||
            !region.after.present ||
            region.after.value.startBeat < region.startBeat ||
            region.after.value.startBeat >= region.endBeat ||
            region.startBeat >= clip.inputs.endBeat ||
            region.endBeat <= clip.inputs.startBeat ||
            (take &&
                (take.trackId !== region.trackId ||
                    take.laneId !== region.laneId ||
                    take.clipId !== region.clipId ||
                    take.inputs.passAnchorSeconds !== undefined))
        ) {
            return false;
        }
    }
    const regionEnds = new Map<string, number>();
    for (const region of [...regions].sort((left, right) => left.startBeat - right.startBeat)) {
        if ((regionEnds.get(region.laneId) ?? -Infinity) > region.startBeat) {
            return false;
        }
        regionEnds.set(region.laneId, region.endBeat);
    }
    const gapEnds = new Map<string, number>();
    for (const gap of [...gaps].sort((left, right) => left.startBeat - right.startBeat)) {
        const clip = clips.find((row) => row.trackId === gap.trackId && row.clipId === gap.clipId);
        const key = JSON.stringify([gap.trackId, gap.laneId, gap.clipId]);
        if (
            !clip ||
            gap.startBeat < clip.inputs.startBeat ||
            gap.endBeat > clip.inputs.endBeat ||
            !gap.after.present ||
            gap.after.value.startBeat !== gap.startBeat ||
            (gapEnds.get(key) ?? -Infinity) > gap.startBeat
        ) {
            return false;
        }
        gapEnds.set(key, gap.endBeat);
    }
    const presenceKeys = new Set<string>();
    for (const field of gapFieldPresence) {
        if (
            !exactKeys(field, ['trackId', 'laneId', 'before', 'after']) ||
            !id(field.trackId) ||
            !id(field.laneId) ||
            typeof field.before !== 'boolean' ||
            field.after !== true ||
            presenceKeys.has(field.laneId) ||
            !gaps.some((gap) => gap.laneId === field.laneId && gap.trackId === field.trackId)
        ) {
            return false;
        }
        presenceKeys.add(field.laneId);
    }
    return gaps.every((gap) => presenceKeys.has(gap.laneId));
}
