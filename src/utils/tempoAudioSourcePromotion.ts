import { isAudioSourceSnapshot, type AudioSourceSnapshot } from './audioSourceTime';
import { type TempoAudioSourcePromotionSnapshot } from './handlerContract';
import { isRecord, valuesEqual } from './structuralEquality';
import { type TempoSourceClock } from './tempoSourceClock';

export type { TempoSourceClock } from './tempoSourceClock';

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

function readAlternativeClips(alternative: unknown): readonly unknown[] | null {
    if (isRecord(alternative) && Array.isArray(alternative.clips)) {
        const clips: unknown[] = alternative.clips;
        return clips;
    }
    return null;
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
        return readAlternativeClips(alternative);
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

const SOURCE_OWNER_STRING_FIELDS = new Set([
    'id',
    'trackId',
    'type',
    'audioBufferId',
    'fileId',
    'assetHash',
    'stretchMode',
    'clipId',
    'takeId',
]);
const SOURCE_OWNER_NUMBER_FIELDS = new Set([
    'startBeat',
    'endBeat',
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'loopLength',
    'loopOriginBeat',
    'stretchRatio',
    'sourceOffsetBeats',
    'sourceOffsetSeconds',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
    'passOriginBeat',
    'passOriginSourceSeconds',
]);

function jsonNumber(value: number): number | null {
    return Number.isFinite(value) ? prefixNumber(value) : null;
}

function prefixNumber(value: number): number {
    return value === 0 ? 0 : value;
}

function projectAudioSourceSnapshot(value: AudioSourceSnapshot): AudioSourceSnapshot {
    return {
        startBeat: prefixNumber(value.startBeat),
        audioOffsetSeconds: prefixNumber(value.audioOffsetSeconds),
        audioLoopStartSeconds: prefixNumber(value.audioLoopStartSeconds),
        audioLoopPassEntrySeconds: prefixNumber(value.audioLoopPassEntrySeconds),
        audioLoopPassOriginBeat: prefixNumber(value.audioLoopPassOriginBeat),
        loopOriginBeat: prefixNumber(value.loopOriginBeat),
        loopLength: prefixNumber(value.loopLength),
    };
}

function projectSourceOwnerFields(
    row: Readonly<Record<string, unknown>>,
    fields: readonly string[]
): Readonly<Record<string, unknown>> | null {
    const selected: Record<string, unknown> = {};
    for (const field of fields) {
        const value = row[field];
        if (value === undefined) {
            continue;
        }
        if (field === 'audioSource') {
            if (!isAudioSourceSnapshot(value)) {
                return null;
            }
            selected[field] = projectAudioSourceSnapshot(value);
        } else if (SOURCE_OWNER_STRING_FIELDS.has(field) && typeof value === 'string') {
            selected[field] = value;
        } else if (SOURCE_OWNER_NUMBER_FIELDS.has(field) && typeof value === 'number') {
            selected[field] = jsonNumber(value);
        } else if (field === 'loopEnabled' && typeof value === 'boolean') {
            selected[field] = value;
        } else {
            return null;
        }
    }
    return selected;
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
    const value = projectSourceOwnerFields(row, fields);
    return value ? { present: true, value } : null;
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

export { isTempoAudioSourcePromotion } from './isTempoAudioSourcePromotion';
