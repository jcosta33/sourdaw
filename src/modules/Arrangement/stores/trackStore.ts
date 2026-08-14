import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { normalizeTrack } from '../models/Track';

import type {
    AutomationMode,
    Clip,
    ClipKneadBlob,
    ClipKneadState,
    Device,
    DeviceStateChunk,
    DeviceStateValue,
    FreezeState,
    InputMonitoring,
    MidiFxDevice,
    Send,
    Track,
    TrackAlternative,
    TrackKind,
} from '../models/Track';

export type {
    AutomationMode,
    Clip,
    Device,
    DeviceStateChunk,
    DeviceStateValue,
    FollowAction,
    InputMonitoring,
    Send,
    StretchMode,
    Track,
    TrackAlternative,
    TrackKind,
} from '../models/Track';

const DOC_PREFIX_ROOT = 'root';

export type TrackStoreState = {
    tracks: Track[];
    selectedTrackId: string | null;
    /** E1: Ephemeral AI-suggested clips not yet part of the tracks. */
    ghostClips?: (Clip & { trackId: string })[];
};

export const defaultTrackState: TrackStoreState = {
    tracks: [],
    selectedTrackId: null,
    ghostClips: [],
};

type PlainObject = {
    [key: string]: unknown;
};

type TrackTransientState = Pick<TrackStoreState, 'selectedTrackId' | 'ghostClips'>;

type TrackSnapshotState = Pick<TrackStoreState, 'tracks' | 'selectedTrackId'>;

type GetOwnValueInput = {
    value: object;
    key: string;
};

type OwnValue = { found: true; value: unknown } | { found: false };

const defaultTrackTransientState: TrackTransientState = {
    selectedTrackId: defaultTrackState.selectedTrackId,
    ghostClips: defaultTrackState.ghostClips,
};

function is_plain_object(value: unknown): value is PlainObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function is_not_null<TValue>(value: TValue | null): value is TValue {
    return value !== null;
}

function get_own_value(input: GetOwnValueInput): OwnValue {
    const descriptor = Object.getOwnPropertyDescriptor(input.value, input.key);
    if (!descriptor) {
        return { found: false };
    }

    if (!('value' in descriptor)) {
        return { found: true, value: undefined };
    }

    return { found: true, value: descriptor.value };
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function is_track_kind(value: unknown): value is TrackKind {
    return value === 'audio' || value === 'midi' || value === 'bus' || value === 'master' || value === 'folder';
}

function is_input_monitoring(value: unknown): value is InputMonitoring {
    return value === 'auto' || value === 'on' || value === 'off';
}

function is_automation_mode(value: unknown): value is AutomationMode {
    return value === 'read' || value === 'write' || value === 'touch' || value === 'latch' || value === 'off';
}

function is_midi_fx_type(value: unknown): value is MidiFxDevice['type'] {
    return value === 'arp' || value === 'velocity' || value === 'probability';
}

function is_freeze_status(value: unknown): value is FreezeState['status'] {
    return value === 'unfrozen' || value === 'freezing' || value === 'frozen' || value === 'stale' || value === 'error';
}

function is_clip_type(value: unknown): value is Clip['type'] {
    return value === 'audio' || value === 'midi';
}

function is_stretch_mode(value: unknown): value is NonNullable<Clip['stretchMode']> {
    return value === 'off' || value === 'repitch' || value === 'timestretch';
}

function is_follow_action(value: unknown): value is NonNullable<Clip['followAction']> {
    return (
        value === 'stop' ||
        value === 'play_next' ||
        value === 'play_previous' ||
        value === 'play_random' ||
        value === 'play_first' ||
        value === 'play_last'
    );
}

function is_string_or_null(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function normalize_parameter_values(value: unknown): MidiFxDevice['parameterValues'] {
    if (!is_plain_object(value)) {
        return {};
    }

    const parameter_values: MidiFxDevice['parameterValues'] = {};
    for (const [key, parameter_value] of Object.entries(value)) {
        if (is_finite_number(parameter_value)) {
            parameter_values[key] = parameter_value;
        }
    }

    return parameter_values;
}

function normalize_clip_overrides(value: unknown): Clip['overrides'] | null {
    if (!is_plain_object(value)) {
        return null;
    }

    const overrides: NonNullable<Clip['overrides']> = {};
    for (const [key, override_value] of Object.entries(value)) {
        if (typeof override_value === 'boolean') {
            overrides[key] = override_value;
        }
    }

    return overrides;
}

function normalize_clip_knead_blob(value: unknown): ClipKneadBlob | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        !is_finite_number(value.startTime) ||
        !is_finite_number(value.endTime) ||
        !is_finite_number(value.pitchCenterCents) ||
        !Array.isArray(value.pitchCurveCents) ||
        !value.pitchCurveCents.every(is_finite_number) ||
        !is_finite_number(value.voicedConfidence)
    ) {
        return null;
    }

    const blob: ClipKneadBlob = {
        id: value.id,
        startTime: value.startTime,
        endTime: value.endTime,
        pitchCenterCents: value.pitchCenterCents,
        pitchCurveCents: value.pitchCurveCents,
        voicedConfidence: value.voicedConfidence,
    };

    if (is_finite_number(value.originalPitchCenterCents)) {
        blob.originalPitchCenterCents = value.originalPitchCenterCents;
    }

    return blob;
}

function normalize_clip_knead_state(value: unknown): ClipKneadState | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (
        !Array.isArray(value.blobs) ||
        !is_finite_number(value.retuneSpeedMs) ||
        !is_finite_number(value.humanizePercent) ||
        typeof value.formantPreserve !== 'boolean'
    ) {
        return null;
    }

    return {
        blobs: value.blobs.map(normalize_clip_knead_blob).filter(is_not_null),
        retuneSpeedMs: value.retuneSpeedMs,
        humanizePercent: value.humanizePercent,
        formantPreserve: value.formantPreserve,
    };
}

function normalize_clip(value: unknown): Clip | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        typeof value.trackId !== 'string' ||
        typeof value.name !== 'string' ||
        !is_finite_number(value.startBeat) ||
        !is_finite_number(value.endBeat) ||
        !is_clip_type(value.type)
    ) {
        return null;
    }

    const clip: Clip = {
        id: value.id,
        trackId: value.trackId,
        name: value.name,
        startBeat: value.startBeat,
        endBeat: value.endBeat,
        type: value.type,
        fadeInBeats: is_finite_number(value.fadeInBeats) ? value.fadeInBeats : 0,
        fadeOutBeats: is_finite_number(value.fadeOutBeats) ? value.fadeOutBeats : 0,
        gain: is_finite_number(value.gain) ? value.gain : 1,
        color: typeof value.color === 'string' ? value.color : '',
        locked: typeof value.locked === 'boolean' ? value.locked : false,
        muted: typeof value.muted === 'boolean' ? value.muted : false,
    };

    if (typeof value.audioBufferId === 'string') {
        clip.audioBufferId = value.audioBufferId;
    }
    if (typeof value.assetHash === 'string') {
        clip.assetHash = value.assetHash;
    }
    if (is_finite_number(value.audioOffsetBeats)) {
        clip.audioOffsetBeats = value.audioOffsetBeats;
    }
    if (is_finite_number(value.midiOffsetBeats)) {
        clip.midiOffsetBeats = value.midiOffsetBeats;
    }
    if (is_stretch_mode(value.stretchMode)) {
        clip.stretchMode = value.stretchMode;
    }
    if (is_finite_number(value.stretchRatio)) {
        clip.stretchRatio = value.stretchRatio;
    }
    if (typeof value.loopEnabled === 'boolean') {
        clip.loopEnabled = value.loopEnabled;
    }
    if (is_finite_number(value.loopLength)) {
        clip.loopLength = value.loopLength;
    }
    if (is_follow_action(value.followAction)) {
        clip.followAction = value.followAction;
    }
    if (typeof value.generating === 'boolean') {
        clip.generating = value.generating;
    }
    if (typeof value.isGhost === 'boolean') {
        clip.isGhost = value.isGhost;
    }
    if (typeof value.isInlineEditing === 'boolean') {
        clip.isInlineEditing = value.isInlineEditing;
    }
    if (typeof value.parentClipId === 'string') {
        clip.parentClipId = value.parentClipId;
    }
    if (typeof value.isLinkedInstance === 'boolean') {
        clip.isLinkedInstance = value.isLinkedInstance;
    }
    if (is_finite_number(value.sourceKeyRoot)) {
        clip.sourceKeyRoot = value.sourceKeyRoot;
    }
    if (typeof value.sourceScaleName === 'string') {
        clip.sourceScaleName = value.sourceScaleName;
    }
    const overrides = normalize_clip_overrides(value.overrides);
    if (overrides) {
        clip.overrides = overrides;
    }
    const knead_state = normalize_clip_knead_state(value.kneadState);
    if (knead_state) {
        clip.kneadState = knead_state;
    }

    return clip;
}

function normalize_clip_array(value: unknown): Clip[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    return value.map(normalize_clip).filter(is_not_null);
}

function normalize_device(value: unknown): Device | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.type !== 'string') {
        return null;
    }

    const device: Device = {
        id: value.id,
        name: value.name,
        type: value.type,
        bypassed: typeof value.bypassed === 'boolean' ? value.bypassed : false,
        parameterValues: normalize_parameter_values(value.parameterValues),
    };

    if (typeof value.externalPluginId === 'string') {
        device.externalPluginId = value.externalPluginId;
    }
    if (typeof value.externalInstanceId === 'string') {
        device.externalInstanceId = value.externalInstanceId;
    }
    if (typeof value.externalStateChunk === 'string') {
        device.externalStateChunk = value.externalStateChunk;
    }
    const device_state = normalize_device_state(value.deviceState);
    if (device_state) {
        device.deviceState = device_state;
    }

    return device;
}

/**
 * Keep only values Automerge can actually store and merge. A chunk arriving from a
 * hand-edited file, a foreign peer or an older build can carry anything; anything
 * this returns null for is dropped from the chunk rather than persisted as garbage.
 */
function normalize_device_state_value(value: unknown): DeviceStateValue | null {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    // Non-finite numbers are the reason this is not a plain `typeof` check: NaN and
    // Infinity survive an Automerge write but not the JSON round-trip the `.sourdaw`
    // snapshot takes, so a kit holding one would reload as `null` and read as a
    // structurally valid chunk carrying a value no device can use.
    if (is_finite_number(value)) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(normalize_device_state_value).filter(is_not_null);
    }
    if (is_plain_object(value)) {
        return normalize_device_state_record(value);
    }
    return null;
}

function normalize_device_state_record(value: PlainObject): { [key: string]: DeviceStateValue } {
    const record: { [key: string]: DeviceStateValue } = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalized = normalize_device_state_value(entry);
        if (normalized !== null || entry === null) {
            record[key] = normalized;
        }
    }
    return record;
}

/**
 * Project a device-state chunk, or null when the slot holds something that is not
 * one.
 *
 * Disposition follows `normalize_freeze_state`: a malformed chunk costs the device
 * its state and nothing more. The device, its track and the rest of the project all
 * still load, and the owning module falls back to its own default — the same outcome
 * as a device that never wrote state. Rejecting the track or the document here would
 * turn one junk scalar written by one build into an unopenable project.
 *
 * `version` is required because it is the only thing that lets a future reader tell
 * a payload it understands from one it does not. A chunk without a finite version is
 * not an old chunk, it is an unidentifiable one, so it is dropped rather than
 * assigned a version it never claimed.
 */
function normalize_device_state(value: unknown): DeviceStateChunk | null {
    if (!is_plain_object(value) || !is_finite_number(value.version)) {
        return null;
    }
    if (!is_plain_object(value.data)) {
        return null;
    }

    return {
        version: value.version,
        data: normalize_device_state_record(value.data),
    };
}

function normalize_device_array(value: unknown): Device[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    return value.map(normalize_device).filter(is_not_null);
}

function normalize_send(value: unknown): Send | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (typeof value.busId !== 'string') {
        return null;
    }

    return {
        busId: value.busId,
        level: is_finite_number(value.level) ? value.level : 0,
        preFader: typeof value.preFader === 'boolean' ? value.preFader : false,
    };
}

function normalize_send_array(value: unknown): Send[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    return value.map(normalize_send).filter(is_not_null);
}

function normalize_midi_fx_device(value: unknown): MidiFxDevice | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (typeof value.id !== 'string' || !is_midi_fx_type(value.type)) {
        return null;
    }

    return {
        id: value.id,
        type: value.type,
        name: typeof value.name === 'string' ? value.name : value.type.charAt(0).toUpperCase() + value.type.slice(1),
        bypassed: typeof value.bypassed === 'boolean' ? value.bypassed : false,
        parameterValues: normalize_parameter_values(value.parameterValues),
    };
}

function normalize_midi_fx_array(value: unknown): MidiFxDevice[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    return value.map(normalize_midi_fx_device).filter(is_not_null);
}

function normalize_track_alternative(value: unknown): TrackAlternative | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (typeof value.id !== 'string' || typeof value.name !== 'string') {
        return null;
    }

    return {
        id: value.id,
        name: value.name,
        clips: normalize_clip_array(value.clips) ?? [],
    };
}

function normalize_track_alternative_array(value: unknown): TrackAlternative[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    return value.map(normalize_track_alternative).filter(is_not_null);
}

function normalize_freeze_state(value: unknown): FreezeState | null {
    if (!is_plain_object(value) || !is_freeze_status(value.status)) {
        return null;
    }

    const freeze_state: FreezeState = {
        status: value.status,
    };

    if (typeof value.freezeId === 'string') {
        freeze_state.freezeId = value.freezeId;
    }
    if (typeof value.frozenBufferId === 'string') {
        freeze_state.frozenBufferId = value.frozenBufferId;
    }
    if (typeof value.frozenAudioHash === 'string') {
        freeze_state.frozenAudioHash = value.frozenAudioHash;
    }
    if (typeof value.sourceContentHash === 'string') {
        freeze_state.sourceContentHash = value.sourceContentHash;
    }
    if (typeof value.deviceChainHash === 'string') {
        freeze_state.deviceChainHash = value.deviceChainHash;
    }
    if (is_finite_number(value.renderProgress)) {
        freeze_state.renderProgress = value.renderProgress;
    }
    if (typeof value.errorMessage === 'string') {
        freeze_state.errorMessage = value.errorMessage;
    }
    if (is_finite_number(value.renderedAt)) {
        freeze_state.renderedAt = value.renderedAt;
    }
    // The plugin-delay figure the chain carried when the buffer was printed —
    // the only one that matches its content. `scheduleFrozenTrack` falls back
    // to the live chain's current latency when this is absent, a path scoped to
    // buffers frozen before the field existed; dropping it here put every
    // reloaded track on that path, and since a latency change never marks a
    // frozen track stale, the drift was silent and permanent.
    //
    // Sign is checked for the same reason `resolveFrozenBufferTail` checks it:
    // `is_finite_number` never looks at sign, and a negative compensation is
    // not merely wrong, it is silencing. `scheduleFrozenTrack` computes
    // `startTime = now + offset + compensation`; a negative value drops
    // `startTime` below `now`, and once the resulting `elapsed` exceeds the
    // buffer duration the function returns `true` without starting a source —
    // which the caller reads as handled, so it skips live scheduling too. The
    // track goes silent with no error. Unreachable from in-app writes, since
    // `getCompensationDelay` maxes over all tracks including the subject and
    // is therefore structurally non-negative; reachable from a hand-edited or
    // foreign document, which is exactly what this projection guards.
    if (is_finite_number(value.compensationSeconds) && value.compensationSeconds >= 0) {
        freeze_state.compensationSeconds = value.compensationSeconds;
    }

    if (is_plain_object(value.renderSettings)) {
        const render_settings = value.renderSettings;
        if (
            is_finite_number(render_settings.sampleRate) &&
            is_finite_number(render_settings.bitDepth) &&
            is_finite_number(render_settings.channelCount) &&
            is_finite_number(render_settings.tailLengthSeconds)
        ) {
            freeze_state.renderSettings = {
                sampleRate: render_settings.sampleRate,
                bitDepth: render_settings.bitDepth,
                channelCount: render_settings.channelCount,
                tailLengthSeconds: render_settings.tailLengthSeconds,
            };
            // Optional on purpose: a document written before the field existed
            // must project without gaining a version it never had, because
            // version 0 is exactly what "absent" is defined to mean. Dropping
            // it instead would be worse than not migrating — a correctly frozen
            // track would read as legacy on every reload and unfreeze itself.
            if (is_finite_number(render_settings.bakeVersion)) {
                freeze_state.renderSettings.bakeVersion = render_settings.bakeVersion;
            }
        }
    }

    return freeze_state;
}

function apply_track_optional_fields(input: {
    source: PlainObject;
    target: Partial<Track> & { id: string; name: string; kind: TrackKind };
}): void {
    const source = input.source;
    const target = input.target;
    const clips = normalize_clip_array(source.clips);
    const devices = normalize_device_array(source.devices);
    const sends = normalize_send_array(source.sends);
    const midi_fx = normalize_midi_fx_array(source.midiFx);
    const alternatives = normalize_track_alternative_array(source.alternatives);
    const freeze_state = normalize_freeze_state(source.freezeState);

    if (typeof source.muted === 'boolean') {
        target.muted = source.muted;
    }
    if (typeof source.soloed === 'boolean') {
        target.soloed = source.soloed;
    }
    if (typeof source.armed === 'boolean') {
        target.armed = source.armed;
    }
    if (is_finite_number(source.gain)) {
        target.gain = source.gain;
    }
    if (is_finite_number(source.pan)) {
        target.pan = source.pan;
    }
    if (typeof source.color === 'string') {
        target.color = source.color;
    }
    if (clips) {
        target.clips = clips;
    }
    if (devices) {
        target.devices = devices;
    }
    if (sends) {
        target.sends = sends;
    }
    if (midi_fx) {
        target.midiFx = midi_fx;
    }
    if (typeof source.frozen === 'boolean') {
        target.frozen = source.frozen;
    }
    if (typeof source.frozenBufferId === 'string') {
        target.frozenBufferId = source.frozenBufferId;
    }
    if (freeze_state) {
        target.freezeState = freeze_state;
    }
    if (is_string_or_null(source.parentId)) {
        target.parentId = source.parentId;
    }
    if (typeof source.collapsed === 'boolean') {
        target.collapsed = source.collapsed;
    }
    if (is_input_monitoring(source.inputMonitoring)) {
        target.inputMonitoring = source.inputMonitoring;
    }
    if (typeof source.hidden === 'boolean') {
        target.hidden = source.hidden;
    }
    if (typeof source.disabled === 'boolean') {
        target.disabled = source.disabled;
    }
    if (is_finite_number(source.height)) {
        target.height = source.height;
    }
    if (typeof source.outputId === 'string') {
        target.outputId = source.outputId;
    }
    if (is_automation_mode(source.automationMode)) {
        target.automationMode = source.automationMode;
    }
    if (is_string_or_null(source.groupId)) {
        target.groupId = source.groupId;
    }
    if (typeof source.soloSafe === 'boolean') {
        target.soloSafe = source.soloSafe;
    }
    if (typeof source.notes === 'string') {
        target.notes = source.notes;
    }
    if (is_string_or_null(source.inputId)) {
        target.inputId = source.inputId;
    }
    if (typeof source.activeAlternativeId === 'string') {
        target.activeAlternativeId = source.activeAlternativeId;
    }
    if (alternatives) {
        target.alternatives = alternatives;
    }
    if (is_string_or_null(source.vcaGroupId)) {
        target.vcaGroupId = source.vcaGroupId;
    }
    if (is_string_or_null(source.midiOutputTrackId)) {
        target.midiOutputTrackId = source.midiOutputTrackId;
    }
    if (typeof source.followChordTrack === 'boolean') {
        target.followChordTrack = source.followChordTrack;
    }
    if (typeof source.showVariationLanes === 'boolean') {
        target.showVariationLanes = source.showVariationLanes;
    }
}

function normalize_track_row(value: unknown): Track | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (typeof value.id !== 'string' || !is_track_kind(value.kind)) {
        return null;
    }

    const track_input: Partial<Track> & { id: string; name: string; kind: TrackKind } = {
        id: value.id,
        name: typeof value.name === 'string' ? value.name : '',
        kind: value.kind,
    };

    apply_track_optional_fields({ source: value, target: track_input });

    return normalizeTrack(track_input);
}

function normalize_tracks(value: unknown): Track[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.map(normalize_track_row).filter(is_not_null);
}

export function sanitizeTrackSnapshot(value: unknown): TrackSnapshotState {
    if (!is_plain_object(value)) {
        return { tracks: [], selectedTrackId: null };
    }

    const tracks_property = get_own_value({ value, key: 'tracks' });
    const tracks = tracks_property.found ? normalize_tracks(tracks_property.value) : [];
    const selected_track_id = get_own_value({ value, key: 'selectedTrackId' });

    if (
        !selected_track_id.found ||
        typeof selected_track_id.value !== 'string' ||
        !tracks.some((track) => track.id === selected_track_id.value)
    ) {
        return { tracks, selectedTrackId: null };
    }

    return { tracks, selectedTrackId: selected_track_id.value };
}

function get_valid_transient_state(value: unknown): TrackTransientState | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (!is_string_or_null(value.selectedTrackId)) {
        return null;
    }

    if ('ghostClips' in value && !Array.isArray(value.ghostClips)) {
        return null;
    }

    return {
        selectedTrackId: value.selectedTrackId,
        ghostClips: Array.isArray(value.ghostClips) ? value.ghostClips.map(normalize_clip).filter(is_not_null) : [],
    };
}

function get_current_track_transient_state(): TrackTransientState {
    return get_valid_transient_state(trackStore.value) ?? defaultTrackTransientState;
}

function sanitize_track_store_state_from_crdt(value: unknown): TrackStoreState {
    const transient_state = get_current_track_transient_state();
    const snapshot_state = sanitizeTrackSnapshot(value);

    // `sanitizeTrackSnapshot` already nulls a `selectedTrackId` that does not
    // resolve against *its own* input, but that check ran against the CRDT
    // payload, not against the live transient value merged in below. Without
    // re-validating here, a track deleted by a collab peer (or dropped by
    // malformed hydration) left `selectedTrackId` pointing at nothing.
    const selected_track_still_exists = snapshot_state.tracks.some(
        (track) => track.id === transient_state.selectedTrackId
    );

    return {
        tracks: snapshot_state.tracks,
        selectedTrackId: selected_track_still_exists ? transient_state.selectedTrackId : null,
        ghostClips: transient_state.ghostClips,
    };
}

export const trackStore = createStore<TrackStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'tracks', {
        toCrdt: ({ tracks }) => ({ tracks }),
        fromCrdt: sanitize_track_store_state_from_crdt,
        // Tracks, clips, devices, midiFx and alternatives all carry an `id`, so
        // the slot reconciles row by row on its own. Sends are the one
        // collection here without one: a send is identified by the bus it
        // feeds, and naming that lets two peers adjust sends to different buses
        // on the same track without overwriting each other.
        crdtEntityIdentity: {
            sends: (row) => (typeof row.busId === 'string' && row.busId.length > 0 ? row.busId : null),
        },
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultTrackState,
    }),
    initialData: defaultTrackState,
});
