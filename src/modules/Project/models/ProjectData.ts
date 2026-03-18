import { type TrackStoreState } from '#/modules/Track/stores/trackStore';
import { type TransportState } from '#/modules/Transport/models/TransportState';
import { type AutomationStoreState } from '#/modules/Track/stores/automationStore';
import { type MidiStoreState } from '#/modules/Track/stores/midiStore';
import { type TempoMapStoreState } from '#/modules/Transport/stores/tempoMapStore';
import { type TimeSignatureMapStoreState } from '#/modules/Transport/stores/timeSignatureMapStore';
import { type MarkerStoreState } from '#/modules/Timeline/stores/markerStore';
import { type TakeLaneStoreState } from '#/modules/Track/stores/takeLaneStore';
import { type SidechainRoute } from '#/modules/AudioEngine/models/SidechainRoute';

export type ProjectData = {
    version: 1;
    name: string;
    createdAt: number;
    updatedAt: number;
    tracks: TrackStoreState;
    transport: Pick<
        TransportState,
        | 'tempo'
        | 'timeSignatureNumerator'
        | 'timeSignatureDenominator'
        | 'loopStart'
        | 'loopEnd'
        | 'isLooping'
        | 'metronomeEnabled'
        | 'metronomeVolume'
        | 'punchInEnabled'
        | 'punchInBeat'
        | 'punchOutBeat'
        | 'countInEnabled'
        | 'countInBars'
        | 'preRollEnabled'
        | 'preRollBars'
        | 'masterGain'
    >;
    automation: AutomationStoreState;
    midi: MidiStoreState;
    tempoMap?: TempoMapStoreState;
    timeSignatureMap?: TimeSignatureMapStoreState;
    markers?: MarkerStoreState;
    takeLanes?: TakeLaneStoreState;
    sidechainRoutes?: SidechainRoute[];
};

export const PROJECT_STORAGE_KEY = 'webdaw-project';
export const PROJECT_LIST_KEY = 'webdaw-project-list';
export const RECENT_PROJECTS_KEY = 'webdaw:recent-projects';
