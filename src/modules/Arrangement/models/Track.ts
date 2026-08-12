import { TRACK_COLOR_PALETTE } from './ColorPalette';

export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type InputMonitoring = 'auto' | 'on' | 'off';

export type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type TrackAlternative = {
    id: string;
    name: string;
    clips: Clip[];
};

export type FreezeState = {
    status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'error';
    freezeId?: string; // Unique render identifier
    frozenBufferId?: string; // Reference to audioBufferCache
    frozenAudioHash?: string; // SHA-256 of rendered audio
    sourceContentHash?: string; // Hash of clips + positions + device states
    deviceChainHash?: string; // Hash of ordered device IDs + states
    renderSettings?: {
        sampleRate: number;
        bitDepth: number; // Always 32 for freeze
        channelCount: number;
        tailLengthSeconds: number;
        /**
         * Which set of freeze rules produced this buffer (`FREEZE_BAKE_VERSION`).
         *
         * Absent means it predates the field, and therefore predates both the
         * declaration-sized tail and the unity-fader print. Such a buffer is
         * physically short and carries its own fader and pan folded in, neither
         * of which any later fix can recover — so staleness detection marks it
         * for re-freezing rather than trusting it.
         */
        bakeVersion?: number;
    };
    /**
     * Seconds of plugin-delay compensation the track carried when the buffer
     * was baked. Frozen playback must shift by *this* value, not by the live
     * chain's current latency: the buffer bypasses the device chain, and a
     * plugin latency change does not mark the track stale (`computeTrackHash`
     * sees no clip/device change), so compensating against the current chain
     * drifts silently and never self-corrects (FX-4 residual).
     */
    compensationSeconds?: number;
    renderProgress?: number; // 0.0-1.0 during freezing
    errorMessage?: string; // Set when status is 'error'
    renderedAt?: number; // Unix epoch ms
};

export type Track = {
    id: string;
    name: string;
    kind: TrackKind;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    color: string;
    clips: Clip[];
    devices: Device[];
    sends: Send[];
    midiFx: MidiFxDevice[];
    frozen: boolean;
    frozenBufferId?: string;
    freezeState: FreezeState;
    parentId: string | null;
    collapsed: boolean;
    inputMonitoring: InputMonitoring;
    hidden: boolean;
    disabled: boolean;
    height: number;
    outputId: string;
    automationMode: AutomationMode;
    groupId: string | null;
    soloSafe: boolean;
    notes: string;
    inputId: string | null;
    activeAlternativeId: string;
    alternatives: TrackAlternative[];
    vcaGroupId: string | null;
    midiOutputTrackId: string | null;
    followChordTrack: boolean;
    /** H3: Toggle for showing alternative lanes in timeline. */
    showVariationLanes?: boolean;
};

export type MidiFxDevice = {
    id: string;
    name: string;
    type: 'arp' | 'velocity' | 'probability';
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

export type StretchMode = 'off' | 'repitch' | 'timestretch';

export type FollowAction = 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';

export type Clip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    audioBufferId?: string;
    /** Content-addressed hash of the audio file (SHA-256 via AssetTransfer).
     *  Set on import; used to request the file from peers in a collab session. */
    assetHash?: string;
    audioOffsetBeats?: number;
    midiOffsetBeats?: number;
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
    stretchMode?: StretchMode;
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    followAction?: FollowAction;
    generating?: boolean;
    isGhost?: boolean;
    /** A11: toggle for in-place MIDI editing in arrangement. */
    isInlineEditing?: boolean;
    /** If set, this clip is a linked instance of another clip (H1). */
    parentClipId?: string;
    /** H1: helper flag for linked status. */
    isLinkedInstance?: boolean;
    /** For non-destructive scale folding (mapping MIDI from source key to project key). */
    sourceKeyRoot?: number;
    /** For non-destructive scale folding. */
    sourceScaleName?: string;
    /** Which properties are locally overridden on this instance. */
    overrides?: Record<string, boolean>;
    /** Real-time pitch correction state for this clip. */
    kneadState?: ClipKneadState;
};

export type ClipKneadState = {
    blobs: ClipKneadBlob[];
    retuneSpeedMs: number;
    humanizePercent: number;
    formantPreserve: boolean;
};

export type ClipKneadBlob = {
    id: string;
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    originalPitchCenterCents?: number;
    pitchCurveCents: number[];
    voicedConfidence: number;
};

/**
 * A JSON-shaped leaf or container inside a device-state chunk. The document must
 * be able to serialize and merge every value, so `undefined`, functions and class
 * instances are excluded by construction.
 */
export type DeviceStateValue =
    string | number | boolean | null | DeviceStateValue[] | { [key: string]: DeviceStateValue };

/**
 * Non-automatable state a device serialises for itself and the host stores without
 * interpreting — the slot VST3 fills with `IComponent::getState` and CLAP with its
 * state extension. It exists because `parameterValues` is `Record<string, number>`
 * and cannot hold names, colours, enum strings, booleans or step sequences.
 *
 * Two deliberate departures from the native-host shape:
 *
 * 1. `data` is a **structured subtree**, not an opaque byte blob. A native host can
 *    use opaque bytes because it has no concurrent editors; this document is
 *    Automerge-backed and `reconcileCrdtSlot` merges it field by field, so two
 *    people editing different parts of one device converge instead of clobbering
 *    the whole chunk. An opaque string would make every edit conflict on everything.
 * 2. `version` is mandatory and owned by the writing device. The chunk is wire
 *    format: a reader that does not recognise the version must degrade to its own
 *    default rather than misread the payload, and a chunk with no version at all is
 *    a migration nobody can write later.
 *
 * Generic on purpose — the slot is addressed by the owning module, not by device
 * type. Nothing device-specific belongs in this model.
 */
export type DeviceStateChunk = {
    version: number;
    data: { [key: string]: DeviceStateValue };
};

export type Device = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
    externalPluginId?: string;
    externalInstanceId?: string;
    /** Opaque native-plugin state chunk (CLAP `clap_ostream` blob), base64. Captured
     *  into project truth at save so editor-driven state survives reopen; preserved
     *  verbatim when the referenced plugin is absent (Decision 0003). */
    externalStateChunk?: string;
    /** Built-in device state that `parameterValues` cannot express. Owned and
     *  versioned by the device's own module; the host stores it without reading it. */
    deviceState?: DeviceStateChunk;
};

export type Send = {
    busId: string;
    level: number;
    preFader: boolean;
};

let trackColorCounter = 0;

export function reserveNextTrackColor(): string {
    const color = TRACK_COLOR_PALETTE[trackColorCounter % TRACK_COLOR_PALETTE.length]!;
    trackColorCounter++;
    return color;
}

export function createTrack(input: {
    color?: string;
    gain?: number;
    id?: string;
    initialAlternativeId?: string;
    initialDeviceId?: string;
    name: string;
    kind: TrackKind;
    parentId?: string;
}): Track {
    const color = input.color ?? reserveNextTrackColor();

    const defaultDevices: Device[] =
        input.kind === 'midi'
            ? [
                  {
                      id: input.initialDeviceId ?? `dev-synth-${crypto.randomUUID().slice(0, 8)}`,
                      name: 'Synth',
                      type: 'builtin-synth',
                      bypassed: false,
                      parameterValues: {},
                  },
              ]
            : [];

    const initialAltId = input.initialAlternativeId ?? `alt-${crypto.randomUUID().slice(0, 8)}`;
    return {
        id: input.id ?? (input.kind === 'master' ? 'master' : `track-${crypto.randomUUID().slice(0, 8)}`),
        name: input.name,
        kind: input.kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: input.gain ?? 0.8,
        pan: 0,
        color,
        clips: [],
        devices: defaultDevices,
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: input.parentId ?? null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: input.kind === 'master' ? 'hw_out' : 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: input.kind === 'bus',
        notes: '',
        inputId: null,
        activeAlternativeId: initialAltId,
        alternatives: [{ id: initialAltId, name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function normalizeMidiFx(fx: Partial<MidiFxDevice> & { id: string; type: MidiFxDevice['type'] }): MidiFxDevice {
    return {
        id: fx.id,
        type: fx.type,
        name: fx.name || fx.type.charAt(0).toUpperCase() + fx.type.slice(1),
        bypassed: fx.bypassed ?? false,
        parameterValues: fx.parameterValues ?? {},
    };
}

export function normalizeTrack(track: Partial<Track> & { id: string; name: string; kind: TrackKind }): Track {
    // Derived deterministically from track.id so re-hydration (CRDT sync) produces the
    // same alternative id each time. A random UUID here would flip on every remote change.
    const defaultAltId = `${track.id}-alt-default`;
    return {
        id: track.id,
        name: track.name,
        kind: track.kind,
        muted: track.muted ?? false,
        soloed: track.soloed ?? false,
        armed: track.armed ?? false,
        gain: track.gain ?? 0.8,
        pan: track.pan ?? 0,
        color: track.color ?? '',
        clips: track.clips ?? [],
        devices: track.devices ?? [],
        sends: track.sends ?? [],
        midiFx: (track.midiFx ?? []).map(normalizeMidiFx),
        frozen: track.frozen ?? false,
        frozenBufferId: track.frozenBufferId,
        freezeState: track.freezeState ?? { status: 'unfrozen' },
        parentId: track.parentId ?? null,
        collapsed: track.collapsed ?? false,
        inputMonitoring: track.inputMonitoring ?? 'auto',
        hidden: track.hidden ?? false,
        disabled: track.disabled ?? false,
        height: track.height || 80,
        outputId: track.outputId ?? (track.kind === 'master' ? 'hw_out' : 'master'),
        automationMode: track.automationMode ?? 'read',
        groupId: track.groupId ?? null,
        soloSafe: track.soloSafe ?? track.kind === 'bus',
        notes: track.notes ?? '',
        inputId: track.inputId ?? null,
        activeAlternativeId: track.activeAlternativeId ?? defaultAltId,
        alternatives: track.alternatives ?? [{ id: defaultAltId, name: 'Alternative 1', clips: [] }],
        vcaGroupId: track.vcaGroupId ?? null,
        midiOutputTrackId: track.midiOutputTrackId ?? null,
        followChordTrack: track.followChordTrack ?? false,
        showVariationLanes: track.showVariationLanes,
    };
}
