import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type InputMonitoring = 'auto' | 'on' | 'off';

export type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

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
    followAction?: FollowAction;
    generating?: boolean;
    isGhost?: boolean;
    parentClipId?: string;
    overrides?: Record<string, boolean>;
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
};

export type TrackStoreState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

export const defaultTrackState: TrackStoreState = {
    tracks: [],
    selectedTrackId: null,
};

export const trackStore = createStore<TrackStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'tracks', {
        toCrdt: ({ tracks }) => ({ tracks }),
    }),
    initialData: defaultTrackState,
});
