import { markerStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';

import { arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';

type SyncArrangementTrackKindInput = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

type SyncArrangementInputMonitoringInput = 'auto' | 'on' | 'off';

type SyncArrangementAutomationModeInput = 'read' | 'write' | 'touch' | 'latch' | 'off';

type SyncArrangementStretchModeInput = 'off' | 'repitch' | 'timestretch';

type SyncArrangementFollowActionInput =
    | 'stop'
    | 'play_next'
    | 'play_previous'
    | 'play_random'
    | 'play_first'
    | 'play_last';

type SyncArrangementClipInput = {
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
    stretchMode?: SyncArrangementStretchModeInput;
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    followAction?: SyncArrangementFollowActionInput;
    generating?: boolean;
    isGhost?: boolean;
    parentClipId?: string;
    overrides?: Record<string, boolean>;
};

type SyncArrangementDeviceInput = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
    externalPluginId?: string;
    externalInstanceId?: string;
};

type SyncArrangementSendInput = {
    busId: string;
    level: number;
    preFader: boolean;
};

type SyncArrangementMidiFxDeviceInput = {
    id: string;
    name: string;
    type: 'arp' | 'velocity' | 'probability';
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

type SyncArrangementFreezeStateInput = {
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

type SyncArrangementTrackAlternativeInput = {
    id: string;
    name: string;
    clips: SyncArrangementClipInput[];
};

type SyncArrangementTrackInput = {
    id: string;
    name: string;
    kind: SyncArrangementTrackKindInput;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    color: string;
    clips: SyncArrangementClipInput[];
    devices: SyncArrangementDeviceInput[];
    sends: SyncArrangementSendInput[];
    midiFx: SyncArrangementMidiFxDeviceInput[];
    frozen: boolean;
    frozenBufferId?: string;
    freezeState: SyncArrangementFreezeStateInput;
    parentId: string | null;
    collapsed: boolean;
    inputMonitoring: SyncArrangementInputMonitoringInput;
    hidden: boolean;
    disabled: boolean;
    height: number;
    outputId: string;
    automationMode: SyncArrangementAutomationModeInput;
    groupId: string | null;
    soloSafe: boolean;
    notes: string;
    inputId: string | null;
    activeAlternativeId: string;
    alternatives: SyncArrangementTrackAlternativeInput[];
    vcaGroupId: string | null;
    midiOutputTrackId: string | null;
    followChordTrack: boolean;
    showVariationLanes?: boolean;
};

export function syncArrangement<TrackInput extends SyncArrangementTrackInput>(tracks: TrackInput[]): void {
    arrangementStore.set({
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks, selectedTrackId: tracks.length > 0 ? (tracks[0]?.id ?? null) : null },
                automation: automationStore.value ?? { lanes: [] },
                midi: midiStore.value ?? { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                tempoMap: { changes: [] },
                timeSignatureMap: { changes: [] },
                markers: markerStore.value ?? { markers: [], sections: [] },
                takeLanes: { lanes: [] },
            },
        ],
        activeArrangementId: defaultArrangementId,
    });
}
