import { createStore } from '#/infra/store/createStore';
import {
    AutomergeStorageWriteConflictError,
    createAutomergeStorage,
} from '#/infra/store/storage/createAutomergeStorage';
import { isFrozenMidiTakeSource } from '#/modules/MIDI/stores';
import {
    hasValidAudioPassOrigin,
    hasValidAudioSourceTiles,
    isAudioSourceSnapshot,
    isAudioSourceTile,
    type AudioSourceTile,
    type AudioSourceSnapshot,
} from '#/utils/audioSourceTime';

import { type CompRegion, type Take, type TakeLane } from '../models/TakeLane';

import {
    appendTakeLaneWriteJournal,
    captureTakeLaneWriteJournal,
    replayTakeLaneWriteJournal,
    type TakeLaneWriteJournal,
} from './takeLaneWriteJournal';

const DOC_PREFIX_ROOT = 'root';

export type TakeLaneStoreState = {
    lanes: TakeLane[];
};

export const defaultTakeLaneStoreState: TakeLaneStoreState = { lanes: [] };

const TAKE_LANE_STORE_STATE_KEYS = ['lanes'] as const;
const TAKE_LANE_REQUIRED_KEYS = ['id', 'trackId', 'takes', 'activeCompRegions'] as const;
const TAKE_LANE_OPTIONAL_KEYS = ['automationLaneId', 'baseGapAudioSources'] as const;
const TAKE_KEYS = ['id', 'clipId', 'name', 'startBeat', 'endBeat', 'selected'] as const;
const TAKE_OPTIONAL_NUMBER_KEYS = [
    'sourceOffsetBeats',
    'sourceOffsetSeconds',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
    'passOriginBeat',
    'passOriginSourceSeconds',
] as const;
const TAKE_OPTIONAL_KEYS = [...TAKE_OPTIONAL_NUMBER_KEYS, 'midiSource', 'recordingPassIndex'] as const;
const COMP_REGION_KEYS = ['startBeat', 'endBeat', 'takeId'] as const;
const COMP_REGION_OPTIONAL_KEYS = ['audioSource'] as const;

type HasExactKeysInput = {
    value: object;
    required_keys: readonly string[];
    optional_keys?: readonly string[];
};

function has_exact_keys({ value, required_keys, optional_keys = [] }: HasExactKeysInput): boolean {
    const value_keys = Object.keys(value);
    const allowed_keys = new Set([...required_keys, ...optional_keys]);

    return required_keys.every((key) => Object.hasOwn(value, key)) && value_keys.every((key) => allowed_keys.has(key));
}

function is_finite_non_negative_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function is_unknown_array(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function get_lane_values(value: unknown): unknown[] | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    if (!('lanes' in value)) {
        return null;
    }

    if (!is_unknown_array(value.lanes)) {
        return null;
    }

    return value.lanes;
}

function hasValidMidiTakeFields(value: object): boolean {
    return (
        (!('recordingPassIndex' in value) ||
            (typeof value.recordingPassIndex === 'number' &&
                Number.isSafeInteger(value.recordingPassIndex) &&
                value.recordingPassIndex >= 0)) &&
        (!('midiSource' in value) || isFrozenMidiTakeSource(value.midiSource))
    );
}

function hasValidTakeOffsets(value: object): boolean {
    return (
        (!('sourceOffsetBeats' in value) || is_finite_non_negative_number(value.sourceOffsetBeats)) &&
        (!('sourceOffsetSeconds' in value) || is_finite_non_negative_number(value.sourceOffsetSeconds))
    );
}

function is_valid_take(value: unknown): value is Take {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'clipId' in value &&
        typeof value.clipId === 'string' &&
        'name' in value &&
        typeof value.name === 'string' &&
        'startBeat' in value &&
        is_finite_non_negative_number(value.startBeat) &&
        'endBeat' in value &&
        is_finite_non_negative_number(value.endBeat) &&
        value.endBeat >= value.startBeat &&
        'selected' in value &&
        typeof value.selected === 'boolean' &&
        // A take without the field reads at its clip's origin; a take with a
        // malformed one is dropped whole, like any other malformed take field.
        hasValidTakeOffsets(value) &&
        is_valid_pass_placement(value) &&
        hasValidAudioPassOrigin(value) &&
        hasValidMidiTakeFields(value)
    );
}

/**
 * A placed pass carries its anchor and its depth together, and only beside the
 * media depth that marks it a pass. A pass recorded ahead of its media sounds
 * before the media begins, so its anchor may be negative; its material lies
 * inside the recording, so its depth may not. A saved exclusive source end
 * must leave material beyond that depth.
 */
function is_valid_pass_placement(value: object): boolean {
    const hasAnchor = 'passAnchorSeconds' in value;
    const hasDepth = 'passDepthSeconds' in value;
    if (!hasAnchor && !hasDepth) {
        return !('passSourceEndSeconds' in value);
    }
    return (
        hasAnchor &&
        hasDepth &&
        'sourceOffsetBeats' in value &&
        is_finite_number(value.passAnchorSeconds) &&
        is_finite_non_negative_number(value.passDepthSeconds) &&
        (!('passSourceEndSeconds' in value) ||
            (is_finite_non_negative_number(value.passSourceEndSeconds) &&
                value.passSourceEndSeconds > value.passDepthSeconds))
    );
}

function is_exact_take(value: unknown): value is Take {
    return (
        is_valid_take(value) && has_exact_keys({ value, required_keys: TAKE_KEYS, optional_keys: TAKE_OPTIONAL_KEYS })
    );
}

function normalize_take(take: Take): Take {
    const sanitized: Take = {
        id: take.id,
        clipId: take.clipId,
        name: take.name,
        startBeat: take.startBeat,
        endBeat: take.endBeat,
        selected: take.selected,
    };
    if (take.sourceOffsetBeats !== undefined) {
        sanitized.sourceOffsetBeats = take.sourceOffsetBeats;
    }
    if (take.sourceOffsetSeconds !== undefined) {
        sanitized.sourceOffsetSeconds = take.sourceOffsetSeconds;
    }
    if (take.passAnchorSeconds !== undefined && take.passDepthSeconds !== undefined) {
        sanitized.passAnchorSeconds = take.passAnchorSeconds;
        sanitized.passDepthSeconds = take.passDepthSeconds;
        if (take.passSourceEndSeconds !== undefined) {
            sanitized.passSourceEndSeconds = take.passSourceEndSeconds;
        }
        if (take.passOriginBeat !== undefined && take.passOriginSourceSeconds !== undefined) {
            sanitized.passOriginBeat = take.passOriginBeat;
            sanitized.passOriginSourceSeconds = take.passOriginSourceSeconds;
        }
    }
    if (take.midiSource !== undefined) {
        sanitized.midiSource = structuredClone(take.midiSource);
    }
    if (take.recordingPassIndex !== undefined) {
        sanitized.recordingPassIndex = take.recordingPassIndex;
    }
    return sanitized;
}

function is_valid_comp_region(value: unknown): value is CompRegion {
    return (
        value !== null &&
        typeof value === 'object' &&
        'startBeat' in value &&
        is_finite_non_negative_number(value.startBeat) &&
        'endBeat' in value &&
        is_finite_non_negative_number(value.endBeat) &&
        value.endBeat >= value.startBeat &&
        'takeId' in value &&
        typeof value.takeId === 'string' &&
        (!('audioSource' in value) || isAudioSourceSnapshot(value.audioSource))
    );
}

function is_exact_comp_region(value: unknown): value is CompRegion {
    return (
        is_valid_comp_region(value) &&
        has_exact_keys({ value, required_keys: COMP_REGION_KEYS, optional_keys: COMP_REGION_OPTIONAL_KEYS })
    );
}

function normalize_comp_region(region: CompRegion): CompRegion {
    const normalized: CompRegion = {
        startBeat: region.startBeat,
        endBeat: region.endBeat,
        takeId: region.takeId,
    };
    if (region.audioSource) {
        normalized.audioSource = structuredClone(region.audioSource);
    }
    return normalized;
}

type SanitizableTakeLane = {
    id: string;
    trackId: string;
    automationLaneId?: string;
    takes: unknown[];
    activeCompRegions: unknown[];
    baseGapAudioSources?: unknown[];
};

function get_sanitizable_take_lane(value: unknown): SanitizableTakeLane | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    if (!('id' in value) || typeof value.id !== 'string') {
        return null;
    }

    if (!('trackId' in value) || typeof value.trackId !== 'string') {
        return null;
    }

    if (!('takes' in value) || !is_unknown_array(value.takes)) {
        return null;
    }

    if (!('activeCompRegions' in value) || !is_unknown_array(value.activeCompRegions)) {
        return null;
    }

    if ('baseGapAudioSources' in value && !is_unknown_array(value.baseGapAudioSources)) {
        return null;
    }

    if ('automationLaneId' in value && typeof value.automationLaneId !== 'string') {
        return null;
    }

    const lane: SanitizableTakeLane = {
        id: value.id,
        trackId: value.trackId,
        takes: value.takes,
        activeCompRegions: value.activeCompRegions,
    };
    if ('automationLaneId' in value && typeof value.automationLaneId === 'string') {
        lane.automationLaneId = value.automationLaneId;
    }
    if ('baseGapAudioSources' in value && is_unknown_array(value.baseGapAudioSources)) {
        lane.baseGapAudioSources = value.baseGapAudioSources;
    }
    return lane;
}

function is_sanitizable_take_lane(value: SanitizableTakeLane | null): value is SanitizableTakeLane {
    return value !== null;
}

function get_normalized_takes(takes: unknown[]): Take[] {
    return takes.filter(is_valid_take).map(normalize_take);
}

function refuseMalformedMidiSources(lanes: readonly unknown[]): void {
    for (const lane of lanes) {
        if (lane === null || typeof lane !== 'object' || !('takes' in lane) || !Array.isArray(lane.takes)) {
            continue;
        }
        const takes: unknown[] = lane.takes;
        for (const take of takes) {
            if (
                take !== null &&
                typeof take === 'object' &&
                'midiSource' in take &&
                !isFrozenMidiTakeSource(take.midiSource)
            ) {
                throw new Error('Invalid frozen MIDI take source');
            }
            if (
                take !== null &&
                typeof take === 'object' &&
                'recordingPassIndex' in take &&
                (typeof take.recordingPassIndex !== 'number' ||
                    !Number.isSafeInteger(take.recordingPassIndex) ||
                    take.recordingPassIndex < 0)
            ) {
                throw new Error('Invalid MIDI recording pass identity');
            }
        }
    }
}

function retain_non_overlapping_regions(regions: CompRegion[]): CompRegion[] {
    const retained_regions: CompRegion[] = [];

    for (const region of regions) {
        const previous_region = retained_regions[retained_regions.length - 1];
        if (previous_region === undefined || previous_region.endBeat <= region.startBeat) {
            retained_regions.push(region);
        }
    }

    return retained_regions;
}

function get_normalized_comp_regions(regions: unknown[], take_ids: ReadonlySet<string>): CompRegion[] {
    return retain_non_overlapping_regions(
        regions
            .filter(is_valid_comp_region)
            .filter((region) => take_ids.has(region.takeId))
            .map(normalize_comp_region)
            .sort((alpha, buffer) => alpha.startBeat - buffer.startBeat)
    );
}

function are_sorted_non_overlapping_regions(regions: CompRegion[]): boolean {
    let previous_end_beat = Number.NEGATIVE_INFINITY;

    for (const region of regions) {
        if (region.startBeat < previous_end_beat) {
            return false;
        }
        previous_end_beat = region.endBeat;
    }

    return true;
}

function is_exact_take_lane(value: unknown): value is TakeLane {
    const take_lane = get_sanitizable_take_lane(value);
    const takes = get_normalized_takes(take_lane?.takes ?? []);
    const regions = take_lane?.activeCompRegions.filter(is_exact_comp_region) ?? [];
    const take_ids = new Set(takes.map((take) => take.id));

    return (
        take_lane !== null &&
        value !== null &&
        typeof value === 'object' &&
        (!('automationLaneId' in value) || typeof value.automationLaneId === 'string') &&
        (!('baseGapAudioSources' in value) || hasValidAudioSourceTiles(value.baseGapAudioSources)) &&
        has_exact_keys({
            value,
            required_keys: TAKE_LANE_REQUIRED_KEYS,
            optional_keys: TAKE_LANE_OPTIONAL_KEYS,
        }) &&
        takes.length === take_lane.takes.length &&
        take_lane.takes.every(is_exact_take) &&
        regions.length === take_lane.activeCompRegions.length &&
        regions.every((region) => take_ids.has(region.takeId)) &&
        are_sorted_non_overlapping_regions(regions)
    );
}

type TakeLaneSnapshotNumbers = 'exact' | 'source-prefix';

function snapshot_number(value: number, numbers: TakeLaneSnapshotNumbers): number {
    return numbers === 'source-prefix' && value === 0 ? 0 : value;
}

function project_exact_audio_source(value: AudioSourceSnapshot, numbers: TakeLaneSnapshotNumbers): AudioSourceSnapshot {
    return {
        startBeat: snapshot_number(value.startBeat, numbers),
        audioOffsetSeconds: snapshot_number(value.audioOffsetSeconds, numbers),
        audioLoopStartSeconds: snapshot_number(value.audioLoopStartSeconds, numbers),
        audioLoopPassEntrySeconds: snapshot_number(value.audioLoopPassEntrySeconds, numbers),
        audioLoopPassOriginBeat: snapshot_number(value.audioLoopPassOriginBeat, numbers),
        loopOriginBeat: snapshot_number(value.loopOriginBeat, numbers),
        loopLength: snapshot_number(value.loopLength, numbers),
    };
}

function canonicalizeSourcePrefixNumbers(value: unknown): void {
    if (value === null || typeof value !== 'object') {
        return;
    }
    for (const key of Reflect.ownKeys(value)) {
        const child: unknown = Reflect.get(value, key);
        if (typeof child === 'number' && Object.is(child, -0)) {
            Reflect.set(value, key, 0);
        } else {
            canonicalizeSourcePrefixNumbers(child);
        }
    }
}

function project_exact_take(value: Take, numbers: TakeLaneSnapshotNumbers): Take {
    const take: Take = {
        id: value.id,
        clipId: value.clipId,
        name: value.name,
        startBeat: snapshot_number(value.startBeat, numbers),
        endBeat: snapshot_number(value.endBeat, numbers),
        selected: value.selected,
    };
    for (const field of TAKE_OPTIONAL_NUMBER_KEYS) {
        const number = value[field];
        if (Object.hasOwn(value, field) && number !== undefined) {
            take[field] = snapshot_number(number, numbers);
        }
    }
    if (Object.hasOwn(value, 'midiSource') && value.midiSource !== undefined) {
        const midiSource = structuredClone(value.midiSource);
        if (numbers === 'source-prefix') {
            canonicalizeSourcePrefixNumbers(midiSource);
        }
        take.midiSource = midiSource;
    }
    if (Object.hasOwn(value, 'recordingPassIndex') && value.recordingPassIndex !== undefined) {
        take.recordingPassIndex = value.recordingPassIndex;
    }
    return take;
}

function project_exact_take_lane(value: TakeLane, numbers: TakeLaneSnapshotNumbers): TakeLane {
    const lane: TakeLane = {
        id: value.id,
        trackId: value.trackId,
        takes: value.takes.map((take) => project_exact_take(take, numbers)),
        activeCompRegions: value.activeCompRegions.map((region) => {
            const projected: CompRegion = {
                startBeat: snapshot_number(region.startBeat, numbers),
                endBeat: snapshot_number(region.endBeat, numbers),
                takeId: region.takeId,
            };
            if (Object.hasOwn(region, 'audioSource') && region.audioSource !== undefined) {
                projected.audioSource = project_exact_audio_source(region.audioSource, numbers);
            }
            return projected;
        }),
    };
    if (Object.hasOwn(value, 'automationLaneId') && value.automationLaneId !== undefined) {
        lane.automationLaneId = value.automationLaneId;
    }
    if (Object.hasOwn(value, 'baseGapAudioSources') && value.baseGapAudioSources !== undefined) {
        lane.baseGapAudioSources = value.baseGapAudioSources.map((tile) => ({
            clipId: tile.clipId,
            startBeat: snapshot_number(tile.startBeat, numbers),
            endBeat: snapshot_number(tile.endBeat, numbers),
            audioSource: project_exact_audio_source(tile.audioSource, numbers),
        }));
    }
    return lane;
}

export function decodeExactTakeLaneSnapshots(
    value: readonly unknown[],
    numbers: TakeLaneSnapshotNumbers = 'exact'
): TakeLane[] | null {
    if (!value.every(is_exact_take_lane)) {
        return null;
    }
    return value.map((lane) => project_exact_take_lane(lane, numbers));
}

function normalize_take_lane(take_lane: SanitizableTakeLane): TakeLane {
    const takes = get_normalized_takes(take_lane.takes);
    const take_ids = new Set(takes.map((take) => take.id));
    const active_comp_regions = get_normalized_comp_regions(take_lane.activeCompRegions, take_ids);

    const baseGaps = take_lane.baseGapAudioSources
        ?.filter(isAudioSourceTile)
        .sort((a, b) => a.clipId.localeCompare(b.clipId) || a.startBeat - b.startBeat);
    const retained: AudioSourceTile[] = [];
    for (const tile of baseGaps ?? []) {
        const previous = retained.at(-1);
        if (!previous || previous.clipId !== tile.clipId || previous.endBeat <= tile.startBeat) {
            retained.push(structuredClone(tile));
        }
    }
    if (take_lane.automationLaneId !== undefined) {
        const lane: TakeLane = {
            id: take_lane.id,
            trackId: take_lane.trackId,
            automationLaneId: take_lane.automationLaneId,
            takes,
            activeCompRegions: active_comp_regions,
        };
        if (baseGaps !== undefined) {
            lane.baseGapAudioSources = retained;
        }
        return lane;
    }

    const lane: TakeLane = {
        id: take_lane.id,
        trackId: take_lane.trackId,
        takes,
        activeCompRegions: active_comp_regions,
    };
    if (baseGaps !== undefined) {
        lane.baseGapAudioSources = retained;
    }
    return lane;
}

function is_exact_take_lane_store_state(value: unknown): value is TakeLaneStoreState {
    const lanes = get_lane_values(value);

    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys({ value, required_keys: TAKE_LANE_STORE_STATE_KEYS }) &&
        lanes !== null &&
        lanes.every(is_exact_take_lane)
    );
}

export function sanitize_take_lane_store_state(value: unknown): TakeLaneStoreState {
    if (is_exact_take_lane_store_state(value)) {
        return value;
    }

    const lanes = get_lane_values(value);
    if (lanes === null) {
        return defaultTakeLaneStoreState;
    }

    refuseMalformedMidiSources(lanes);

    return {
        lanes: lanes.map(get_sanitizable_take_lane).filter(is_sanitizable_take_lane).map(normalize_take_lane),
    };
}

function get_replay_authority(
    authority_value: TakeLaneStoreState | null,
    metadata: TakeLaneWriteJournal
): TakeLaneStoreState | null {
    if (authority_value !== null) {
        return sanitize_take_lane_store_state(authority_value);
    }

    const initial_operation = metadata[0];
    if (initial_operation?.kind === 'replace-state' && initial_operation.expected === null) {
        return null;
    }

    return defaultTakeLaneStoreState;
}

export const takeLaneStore = createStore<TakeLaneStoreState>({
    storage: createAutomergeStorage<TakeLaneStoreState, TakeLaneWriteJournal>(DOC_PREFIX_ROOT, 'takeLanes', {
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultTakeLaneStoreState,
        writeMetadata: {
            captureMode: 'values',
            capture: ({ beforeValue, nextValue }) => captureTakeLaneWriteJournal({ beforeValue, nextValue }),
            reduce: ({ current, captured }) => appendTakeLaneWriteJournal(current, captured),
        },
        rebasePendingOnDocumentChange: true,
        rebasePending: ({ hydratedValue, metadata, pendingValue, document }) => {
            if (!metadata) {
                return pendingValue;
            }
            const replay = replayTakeLaneWriteJournal(hydratedValue, metadata, document);
            return replay.status === 'applied' ? replay.value : hydratedValue;
        },
        mutateCrdtWithMetadata: ({ authorityValue, baseValue, metadata, reconcile, value, doc }) => {
            if (!metadata) {
                reconcile(value, baseValue);
                return;
            }
            const authority = get_replay_authority(authorityValue, metadata);
            const replay = replayTakeLaneWriteJournal(authority, metadata, doc);
            if (replay.status === 'conflict') {
                throw new AutomergeStorageWriteConflictError(
                    'Take lane write conflicts with current authoritative state'
                );
            }
            reconcile(replay.value, authority);
        },
    }),
    initialData: defaultTakeLaneStoreState,
    sanitize: sanitize_take_lane_store_state,
});
