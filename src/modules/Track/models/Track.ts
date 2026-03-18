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
};

export type StretchMode = 'off' | 'repitch' | 'timestretch';

export type Clip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    audioBufferId?: string;
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

const TRACK_COLOR_PALETTE = [
    '#3b82f6',
    '#ef4444',
    '#22c55e',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#f97316',
    '#14b8a6',
    '#6366f1',
    '#84cc16',
    '#e11d48',
] as const;

let trackColorCounter = 0;

export function createTrack(input: { name: string; kind: TrackKind; parentId?: string }): Track {
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
        id: `track-${crypto.randomUUID().slice(0, 8)}`,
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
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: input.kind === 'bus',
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
    };
}
