import { TRACK_COLOR_PALETTE } from './colorPalette';

export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type InputMonitoring = 'auto' | 'on' | 'off';

export type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type TrackAlternative = {
    id: string;
    name: string;
    clips: Clip[];
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
    frozen: boolean;
    frozenBufferId?: string;
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
    pitchCurveCents: number[];
    voicedConfidence: number;
};

export type Device = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
    externalPluginId?: string;
    externalInstanceId?: string;
};

export type Send = {
    busId: string;
    level: number;
    preFader: boolean;
};

let trackColorCounter = 0;

export function createTrack(input: { id?: string; name: string; kind: TrackKind; parentId?: string }): Track {
    const color = TRACK_COLOR_PALETTE[trackColorCounter % TRACK_COLOR_PALETTE.length]!;
    trackColorCounter++;

    const defaultDevices: Device[] =
        input.kind === 'midi'
            ? [
                  {
                      id: `dev-synth-${crypto.randomUUID().slice(0, 8)}`,
                      name: 'Synth',
                      type: 'builtin-synth',
                      bypassed: false,
                      parameterValues: {},
                  },
              ]
            : [];

    return {
        id: input.id ?? (input.kind === 'master' ? 'master' : `track-${crypto.randomUUID().slice(0, 8)}`),
        name: input.name,
        kind: input.kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color,
        clips: [],
        devices: defaultDevices,
        sends: [],
        frozen: false,
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
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}
