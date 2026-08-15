import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type ProjectTrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type ProjectInputMonitoring = 'auto' | 'on' | 'off';

export type ProjectAutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type ProjectStretchMode = 'off' | 'repitch' | 'timestretch';

export type ProjectFollowAction = 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';

export type ProjectClipKneadBlob = {
    id: string;
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    originalPitchCenterCents?: number;
    pitchCurveCents: number[];
    voicedConfidence: number;
};

export type ProjectClipKneadState = {
    blobs: ProjectClipKneadBlob[];
    retuneSpeedMs: number;
    humanizePercent: number;
    formantPreserve: boolean;
};

export type ProjectClip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    audioBufferId?: string;
    assetHash?: string;
    audioOffsetBeats?: number;
    midiOffsetBeats?: number;
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
    stretchMode?: ProjectStretchMode;
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    followAction?: ProjectFollowAction;
    generating?: boolean;
    isGhost?: boolean;
    isInlineEditing?: boolean;
    parentClipId?: string;
    isLinkedInstance?: boolean;
    sourceKeyRoot?: number;
    sourceScaleName?: string;
    overrides?: Record<string, boolean>;
    kneadState?: ProjectClipKneadState;
};

export type ProjectDevice = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
    externalPluginId?: string;
    externalInstanceId?: string;
    /** Opaque native-plugin state chunk (base64) carried through arrangement
     *  snapshots so per-arrangement native plugin state survives reopen (PH-3). */
    externalStateChunk?: string;
    /** Built-in device state `parameterValues` cannot express, versioned and owned
     *  by the device's own module. Carried verbatim; this layer never reads it. */
    deviceState?: ArrangementDeviceStateChunk;
};

/**
 * Local mirror of the Arrangement `DeviceStateValue` model — duplicated rather than
 * imported, like the rest of the shapes in this file; structural typing keeps them
 * assignable across the snapshot boundary.
 */
type ArrangementDeviceStateValue =
    string | number | boolean | null | ArrangementDeviceStateValue[] | { [key: string]: ArrangementDeviceStateValue };

type ArrangementDeviceStateChunk = {
    version: number;
    data: { [key: string]: ArrangementDeviceStateValue };
};

export type ProjectSend = {
    busId: string;
    level: number;
    preFader: boolean;
};

export type ProjectMidiFxDevice = {
    id: string;
    name: string;
    type: 'arp' | 'velocity' | 'probability';
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

export type ProjectFreezeState = {
    status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'error';
    freezeId?: string;
    frozenBufferId?: string;
    frozenAudioHash?: string;
    sourceContentHash?: string;
    deviceChainHash?: string;
    renderSettings?: {
        sampleRate: number;
        bitDepth: number;
        channelCount: number;
        tailLengthSeconds: number;
        /** Which set of freeze rules printed this buffer (`FREEZE_BAKE_VERSION`); absent means it predates the field. */
        bakeVersion?: number;
    };
    /** Plugin-delay compensation baked into the buffer; frozen playback shifts by this, not the live chain's latency. */
    compensationSeconds?: number;
    renderProgress?: number;
    errorMessage?: string;
    renderedAt?: number;
};

export type ProjectTrackAlternative = {
    id: string;
    name: string;
    clips: ProjectClip[];
};

export type ProjectTrack = {
    id: string;
    name: string;
    kind: ProjectTrackKind;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    color: string;
    clips: ProjectClip[];
    devices: ProjectDevice[];
    sends: ProjectSend[];
    midiFx: ProjectMidiFxDevice[];
    frozen: boolean;
    frozenBufferId?: string;
    freezeState: ProjectFreezeState;
    parentId: string | null;
    collapsed: boolean;
    inputMonitoring: ProjectInputMonitoring;
    hidden: boolean;
    disabled: boolean;
    height: number;
    outputId: string;
    automationMode: ProjectAutomationMode;
    groupId: string | null;
    soloSafe: boolean;
    notes: string;
    inputId: string | null;
    activeAlternativeId: string;
    alternatives: ProjectTrackAlternative[];
    vcaGroupId: string | null;
    midiOutputTrackId: string | null;
    followChordTrack: boolean;
    showVariationLanes?: boolean;
};

export type ProjectTrackStoreState = {
    tracks: ProjectTrack[];
    selectedTrackId: string | null;
};

export type ProjectTempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

export type ProjectTempoMapState = {
    changes: ProjectTempoChange[];
};

export type ProjectTimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

export type ProjectTimeSignatureMapState = {
    changes: ProjectTimeSignatureChange[];
};

export type ProjectMarker = {
    id: string;
    beat: number;
    name: string;
    color: string;
};

export type ProjectArrangementSection = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
};

export type ProjectMarkerState = {
    markers: ProjectMarker[];
    sections: ProjectArrangementSection[];
};

export type ProjectTake = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
};

export type ProjectCompRegion = {
    startBeat: number;
    endBeat: number;
    takeId: string;
};

export type ProjectTakeLane = {
    id: string;
    trackId: string;
    takes: ProjectTake[];
    activeCompRegions: ProjectCompRegion[];
};

export type ProjectTakeLaneStoreState = {
    lanes: ProjectTakeLane[];
};

export type ProjectAutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth' | 'bezier';

export type ProjectAutomationPoint = {
    beat: number;
    value: number;
    curve: ProjectAutomationCurveType;
    tension: number;
    stairSteps?: number;
    cp1?: { x: number; y: number };
    cp2?: { x: number; y: number };
};

export type ProjectAutomationObject = {
    id: string;
    laneId: string;
    startBeat: number;
    endBeat: number;
    points: ProjectAutomationPoint[];
    poolId?: string;
    loopLength?: number;
    name: string;
};

export type ProjectAutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    clipAutomationMode?: 'additive' | 'multiplicative';
    parameterId: string;
    parameterName: string;
    points: ProjectAutomationPoint[];
    trimPoints?: ProjectAutomationPoint[];
    objects: ProjectAutomationObject[];
    visible: boolean;
    enabled: boolean;
    collapsed: boolean;
    minValue: number;
    maxValue: number;
    viewMinValue?: number;
    viewMaxValue?: number;
    color?: string;
};

export type ProjectAutomationState = {
    lanes: ProjectAutomationLane[];
};

export type ProjectMidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
    channel?: number;
    articulation?: string;
};

export type ProjectMidiCC = {
    id: string;
    controller: number;
    value: number;
    beat: number;
    channel: number;
};

export type ProjectMidiPitchBend = {
    id: string;
    value: number;
    beat: number;
    channel: number;
};

export type ProjectMidiState = {
    notesByClipId: Record<string, ProjectMidiNote[]>;
    ccByClipId: Record<string, ProjectMidiCC[]>;
    pitchBendByClipId: Record<string, ProjectMidiPitchBend[]>;
};

export type ArrangementSnapshot = {
    id: string;
    name: string;
    tracks: ProjectTrackStoreState;
    automation: ProjectAutomationState;
    midi: ProjectMidiState;
    tempoMap?: ProjectTempoMapState;
    timeSignatureMap?: ProjectTimeSignatureMapState;
    markers?: ProjectMarkerState;
    takeLanes?: ProjectTakeLaneStoreState;
};

export type ArrangementStoreState = {
    arrangements: ArrangementSnapshot[];
    activeArrangementId: string;
};

export const defaultArrangementId = 'default-arrangement';

function create_default_arrangement_store_state(): ArrangementStoreState {
    return {
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
        activeArrangementId: defaultArrangementId,
    };
}

export const defaultArrangementStoreState: ArrangementStoreState = create_default_arrangement_store_state();

const ARRANGEMENT_STORE_STATE_KEYS = ['arrangements', 'activeArrangementId'] as const;
const SNAPSHOT_REQUIRED_KEYS = ['id', 'name', 'tracks', 'automation', 'midi'] as const;
const SNAPSHOT_OPTIONAL_KEYS = ['tempoMap', 'timeSignatureMap', 'markers', 'takeLanes'] as const;
const TRACKS_SECTION_KEYS = ['tracks', 'selectedTrackId'] as const;
const AUTOMATION_SECTION_KEYS = ['lanes'] as const;
const MIDI_SECTION_KEYS = ['notesByClipId', 'ccByClipId', 'pitchBendByClipId'] as const;
const CHANGES_SECTION_KEYS = ['changes'] as const;
const MARKERS_SECTION_KEYS = ['markers', 'sections'] as const;
const TAKE_LANES_SECTION_KEYS = ['lanes'] as const;

type PlainObject = {
    [key: string]: unknown;
};

type HasExactKeysInput = {
    value: object;
    required_keys: readonly string[];
    optional_keys?: readonly string[];
};

function is_plain_object(value: unknown): value is PlainObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function has_exact_keys({ value, required_keys, optional_keys = [] }: HasExactKeysInput): boolean {
    return (
        required_keys.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => required_keys.includes(key) || optional_keys.includes(key))
    );
}

function is_string_or_null(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function is_not_null<TValue>(value: TValue | null): value is TValue {
    return value !== null;
}

/** Container-level row check — the hydration trust boundary for this store.
 * The sanitizer guarantees the structural invariants every consumer of this
 * store assumes without re-validating: the state/snapshot/section containers,
 * each row's identity (plain object + string `id`), and — because
 * buildProjectData() iterates EVERY arrangement (inactive ones never pass
 * through loadSnapshot()'s deep validators) — per-track structural shape:
 * `clips` is an array of identified rows, `alternatives` is a NON-EMPTY array
 * of identified rows each carrying a `clips` array of identified rows (empty
 * or fully-dropped alternatives are repaired to the canonical
 * `${id}-alt-default` alternative, with `activeAlternativeId` repointed at a
 * real alternative when it dangles — mirroring normalizeTrack()/hydrateTrack()),
 * and `freezeState` is a plain object (defaulted to `{ status: 'unfrozen' }`,
 * mirroring createTrack() in Arrangement models). Deep per-FIELD row
 * validation is deliberately NOT duplicated here: the restore path owns it —
 * loadSnapshot() routes every ACTIVE-arrangement section from `unknown`
 * through the owning modules' sanitizers (sanitizeTrackSnapshot,
 * restoreAutomationSnapshot, setMidiStoreState, restoreTimelineMapSnapshot,
 * restoreArrangementMetadataSnapshot) before any row reaches a live store. */
function is_identified_row(value: unknown): boolean {
    return is_plain_object(value) && typeof value.id === 'string';
}

function is_row_array(value: unknown): boolean {
    return Array.isArray(value) && value.every(is_identified_row);
}

function filter_identified_rows<TRow extends { id: string }>(value: unknown): TRow[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((row): row is TRow => is_identified_row(row));
}

function is_exact_alternative_row(value: unknown): value is ProjectTrackAlternative {
    return is_plain_object(value) && typeof value.id === 'string' && is_row_array(value.clips);
}

function normalize_alternative_row(value: unknown): ProjectTrackAlternative | null {
    if (is_exact_alternative_row(value)) {
        return value;
    }
    if (!is_plain_object(value) || typeof value.id !== 'string') {
        return null;
    }
    const repaired = { ...value, clips: filter_identified_rows<ProjectClip>(value.clips) };
    // The guard re-check narrows the repaired shape without a cast; it holds
    // by construction.
    return is_exact_alternative_row(repaired) ? repaired : null;
}

function normalize_alternative_rows(value: unknown): ProjectTrackAlternative[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(normalize_alternative_row).filter(is_not_null);
}

function is_exact_track_row(value: unknown): value is ProjectTrack {
    return (
        is_plain_object(value) &&
        typeof value.id === 'string' &&
        is_row_array(value.clips) &&
        Array.isArray(value.alternatives) &&
        // Every canonical constructor guarantees ≥1 alternative; an empty
        // array must not pass exact, or pass-by-reference would smuggle a
        // track whose alternatives feature is silently broken.
        value.alternatives.length > 0 &&
        value.alternatives.every((alternative) => is_exact_alternative_row(alternative)) &&
        is_plain_object(value.freezeState)
    );
}

function normalize_track_row(value: unknown): ProjectTrack | null {
    if (is_exact_track_row(value)) {
        return value;
    }
    if (!is_plain_object(value) || typeof value.id !== 'string') {
        return null;
    }
    const alternatives = normalize_alternative_rows(value.alternatives);
    if (alternatives.length === 0) {
        // Mirror normalizeTrack()/hydrateTrack(): every track carries at least
        // one alternative, and its id is derived deterministically from the
        // track id so CRDT re-hydration produces the same id each time.
        alternatives.push({ id: `${value.id}-alt-default`, name: 'Alternative 1', clips: [] });
    }
    const active_alternative_id =
        typeof value.activeAlternativeId === 'string' &&
        alternatives.some((alternative) => alternative.id === value.activeAlternativeId)
            ? value.activeAlternativeId
            : alternatives[0]!.id;
    const repaired = {
        ...value,
        clips: filter_identified_rows<ProjectClip>(value.clips),
        alternatives,
        activeAlternativeId: active_alternative_id,
        freezeState: is_plain_object(value.freezeState) ? value.freezeState : { status: 'unfrozen' },
    };
    // The guard re-check narrows the repaired shape without a cast; it holds
    // by construction.
    return is_exact_track_row(repaired) ? repaired : null;
}

function normalize_track_rows(value: unknown): ProjectTrack[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(normalize_track_row).filter(is_not_null);
}

function is_exact_tracks_section(value: unknown): value is ProjectTrackStoreState {
    return (
        is_plain_object(value) &&
        has_exact_keys({ value, required_keys: TRACKS_SECTION_KEYS }) &&
        Array.isArray(value.tracks) &&
        value.tracks.every((track) => is_exact_track_row(track)) &&
        is_string_or_null(value.selectedTrackId)
    );
}

function normalize_tracks_section(value: unknown): ProjectTrackStoreState | null {
    if (!is_plain_object(value)) {
        return null;
    }
    return {
        tracks: normalize_track_rows(value.tracks),
        selectedTrackId: is_string_or_null(value.selectedTrackId) ? value.selectedTrackId : null,
    };
}

/**
 * Lane keys that were removed from the lane model and must not survive a
 * hydrate. `virginTerritory` is the first: a lane flag that never affected
 * playback or rendering and was deleted rather than given a meaning.
 *
 * ## Why a removed key needs stripping here
 *
 * This store validates lanes structurally and shallowly on purpose — deep
 * per-lane validation is `automationStore`'s job (see the trust-boundary note
 * above), and that only runs for the ACTIVE arrangement. That deferral leaves a
 * hole for a retired key: a peer still running a build from before the removal
 * syncs an arrangement whose lanes carry the dead field, every lane is a
 * perfectly valid identified row, so the section reads as exact and is stored
 * verbatim. The field then rides `buildProjectData`'s shallow spread of the
 * snapshot into the saved project file, and the dead key lives forever — the
 * same failure the file import path strips during legacy normalization,
 * arriving over sync instead.
 *
 * **Invariant: a lane carrying a removed legacy key must be rebuilt, not passed
 * through.** Adding a key to this list is what enforces it, and it costs no deep
 * validation.
 *
 * ## The reverse direction, which this cannot fix
 *
 * Read this before removing any further *required* key from a lane.
 *
 * The live document is a wire format shared with peers that may run different
 * builds, and lane validation is structural and version-blind — no peer or
 * protocol version is negotiated anywhere in the sync layer. So a peer running
 * an older build, receiving lanes that lack a key its own validator still
 * requires, rejects every one of them. Those lanes are filtered out rather than
 * quarantined, and because the sanitized result is written back, that peer can
 * propagate an emptied automation-lanes array to everyone — including peers on
 * the current build. Silent, propagating data loss originating from the peer
 * that is behind.
 *
 * Nothing shipped later can change how an already-released build validates, so
 * the safe sequence for removing a required key is two releases: first stop
 * requiring it while still emitting it, then stop emitting it once no older peer
 * can connect. Removing `virginTerritory` in one step was safe only because the
 * app had no tagged release and therefore no older peer in existence.
 */
const RETIRED_AUTOMATION_LANE_KEYS = ['virginTerritory'] as const;

function has_retired_automation_lane_key(value: unknown): boolean {
    return is_plain_object(value) && RETIRED_AUTOMATION_LANE_KEYS.some((key) => key in value);
}

function has_any_retired_automation_lane_key(lanes: unknown): boolean {
    return Array.isArray(lanes) && lanes.some(has_retired_automation_lane_key);
}

function strip_retired_automation_lane_keys(lane: ProjectAutomationLane): ProjectAutomationLane {
    if (!has_retired_automation_lane_key(lane)) {
        return lane;
    }
    const stripped = { ...lane };
    for (const key of RETIRED_AUTOMATION_LANE_KEYS) {
        Reflect.deleteProperty(stripped, key);
    }
    return stripped;
}

function is_exact_automation_section(value: unknown): value is ProjectAutomationState {
    return (
        is_plain_object(value) &&
        has_exact_keys({ value, required_keys: AUTOMATION_SECTION_KEYS }) &&
        is_row_array(value.lanes) &&
        // A lane carrying a retired key is not "exact" — fall through to
        // normalize so the key is stripped instead of stored verbatim.
        !has_any_retired_automation_lane_key(value.lanes)
    );
}

function normalize_automation_section(value: unknown): ProjectAutomationState | null {
    if (!is_plain_object(value)) {
        return null;
    }
    return {
        lanes: filter_identified_rows<ProjectAutomationLane>(value.lanes).map(strip_retired_automation_lane_keys),
    };
}

function is_exact_midi_clip_map(value: unknown): boolean {
    return is_plain_object(value) && Object.values(value).every((rows) => is_row_array(rows));
}

function normalize_midi_clip_map<TRow extends { id: string }>(value: unknown): Record<string, TRow[]> {
    if (!is_plain_object(value)) {
        return {};
    }
    const next: Record<string, TRow[]> = {};
    for (const [clip_id, rows] of Object.entries(value)) {
        if (Array.isArray(rows)) {
            next[clip_id] = filter_identified_rows<TRow>(rows);
        }
    }
    return next;
}

function is_exact_midi_section(value: unknown): value is ProjectMidiState {
    return (
        is_plain_object(value) &&
        has_exact_keys({ value, required_keys: MIDI_SECTION_KEYS }) &&
        is_exact_midi_clip_map(value.notesByClipId) &&
        is_exact_midi_clip_map(value.ccByClipId) &&
        is_exact_midi_clip_map(value.pitchBendByClipId)
    );
}

function normalize_midi_section(value: unknown): ProjectMidiState | null {
    if (!is_plain_object(value)) {
        return null;
    }
    return {
        notesByClipId: normalize_midi_clip_map<ProjectMidiNote>(value.notesByClipId),
        ccByClipId: normalize_midi_clip_map<ProjectMidiCC>(value.ccByClipId),
        pitchBendByClipId: normalize_midi_clip_map<ProjectMidiPitchBend>(value.pitchBendByClipId),
    };
}

function is_exact_changes_section(value: unknown): boolean {
    return (
        is_plain_object(value) &&
        has_exact_keys({ value, required_keys: CHANGES_SECTION_KEYS }) &&
        is_row_array(value.changes)
    );
}

function normalize_tempo_map(value: unknown): ProjectTempoMapState | undefined {
    if (!is_plain_object(value)) {
        return undefined;
    }
    return { changes: filter_identified_rows<ProjectTempoChange>(value.changes) };
}

function normalize_time_signature_map(value: unknown): ProjectTimeSignatureMapState | undefined {
    if (!is_plain_object(value)) {
        return undefined;
    }
    return { changes: filter_identified_rows<ProjectTimeSignatureChange>(value.changes) };
}

function is_exact_markers_section(value: unknown): boolean {
    return (
        is_plain_object(value) &&
        has_exact_keys({ value, required_keys: MARKERS_SECTION_KEYS }) &&
        is_row_array(value.markers) &&
        is_row_array(value.sections)
    );
}

function normalize_markers_section(value: unknown): ProjectMarkerState | undefined {
    if (!is_plain_object(value)) {
        return undefined;
    }
    return {
        markers: filter_identified_rows<ProjectMarker>(value.markers),
        sections: filter_identified_rows<ProjectArrangementSection>(value.sections),
    };
}

function is_exact_take_lanes_section(value: unknown): boolean {
    return (
        is_plain_object(value) &&
        has_exact_keys({ value, required_keys: TAKE_LANES_SECTION_KEYS }) &&
        is_row_array(value.lanes)
    );
}

function normalize_take_lanes_section(value: unknown): ProjectTakeLaneStoreState | undefined {
    if (!is_plain_object(value)) {
        return undefined;
    }
    return { lanes: filter_identified_rows<ProjectTakeLane>(value.lanes) };
}

function is_exact_snapshot(value: unknown): value is ArrangementSnapshot {
    return (
        is_plain_object(value) &&
        has_exact_keys({ value, required_keys: SNAPSHOT_REQUIRED_KEYS, optional_keys: SNAPSHOT_OPTIONAL_KEYS }) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        is_exact_tracks_section(value.tracks) &&
        is_exact_automation_section(value.automation) &&
        is_exact_midi_section(value.midi) &&
        (!Object.hasOwn(value, 'tempoMap') || is_exact_changes_section(value.tempoMap)) &&
        (!Object.hasOwn(value, 'timeSignatureMap') || is_exact_changes_section(value.timeSignatureMap)) &&
        (!Object.hasOwn(value, 'markers') || is_exact_markers_section(value.markers)) &&
        (!Object.hasOwn(value, 'takeLanes') || is_exact_take_lanes_section(value.takeLanes))
    );
}

function normalize_snapshot(value: unknown): ArrangementSnapshot | null {
    if (is_exact_snapshot(value)) {
        return value;
    }

    if (!is_plain_object(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
        return null;
    }

    const tracks = normalize_tracks_section(value.tracks);
    const automation = normalize_automation_section(value.automation);
    const midi = normalize_midi_section(value.midi);
    if (!tracks || !automation || !midi) {
        return null;
    }

    const snapshot: ArrangementSnapshot = { id: value.id, name: value.name, tracks, automation, midi };

    const tempoMap = normalize_tempo_map(value.tempoMap);
    if (tempoMap) {
        snapshot.tempoMap = tempoMap;
    }
    const timeSignatureMap = normalize_time_signature_map(value.timeSignatureMap);
    if (timeSignatureMap) {
        snapshot.timeSignatureMap = timeSignatureMap;
    }
    const markers = normalize_markers_section(value.markers);
    if (markers) {
        snapshot.markers = markers;
    }
    const takeLanes = normalize_take_lanes_section(value.takeLanes);
    if (takeLanes) {
        snapshot.takeLanes = takeLanes;
    }

    return snapshot;
}

function is_exact_arrangement_store_state(value: unknown): value is ArrangementStoreState {
    return (
        is_plain_object(value) &&
        has_exact_keys({ value, required_keys: ARRANGEMENT_STORE_STATE_KEYS }) &&
        typeof value.activeArrangementId === 'string' &&
        Array.isArray(value.arrangements) &&
        value.arrangements.every((snapshot) => is_exact_snapshot(snapshot))
    );
}

export function sanitize_arrangement_store_state(value: unknown): ArrangementStoreState {
    if (is_exact_arrangement_store_state(value)) {
        return value;
    }

    if (!is_plain_object(value)) {
        return create_default_arrangement_store_state();
    }

    const default_state = create_default_arrangement_store_state();

    return {
        arrangements: Array.isArray(value.arrangements)
            ? value.arrangements.map(normalize_snapshot).filter(is_not_null)
            : default_state.arrangements,
        activeArrangementId:
            typeof value.activeArrangementId === 'string'
                ? value.activeArrangementId
                : default_state.activeArrangementId,
    };
}

export const arrangementStore = createStore<ArrangementStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'arrangements', {
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultArrangementStoreState,
    }),
    initialData: defaultArrangementStoreState,
    sanitize: sanitize_arrangement_store_state,
});
