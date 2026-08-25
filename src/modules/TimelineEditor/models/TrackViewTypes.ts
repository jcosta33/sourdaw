/**
 * TimelineEditor-local view shape of Arrangement's Track/Clip/Device models
 * (model isolation — these are NOT re-exports). Mirrors the per-module
 * `TrackViewTypes` duplication pattern used across the app.
 *
 * If Arrangement changes its model, structural compatibility will catch
 * the break at the consumption site — which is the intended signal.
 */

export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type StretchMode = 'off' | 'repitch' | 'timestretch';

export type InputMonitoring = 'auto' | 'on' | 'off';

export type FollowAction = 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';

export type Send = {
    busId: string;
    level: number;
    preFader: boolean;
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

export type MidiFx = {
    id: string;
    name: string;
    type: 'arp' | 'velocity' | 'probability';
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

export type Clip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    audioBufferId?: string;
    assetHash?: string;
    audioOffsetBeats?: number;
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
    midiOffsetBeats?: number;
    followAction?: FollowAction;
    generating?: boolean;
    isGhost?: boolean;
    parentClipId?: string;
    overrides?: Record<string, boolean>;
};

export type TrackAlternative = {
    id: string;
    name: string;
    clips: Clip[];
};

export type FreezeState = {
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
    };
    renderProgress?: number;
    errorMessage?: string;
    renderedAt?: number;
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
    midiFx: MidiFx[];
    sends: Send[];
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
};
