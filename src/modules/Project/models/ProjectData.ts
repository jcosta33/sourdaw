import { type TrackStoreState } from '#/modules/Arrangement/stores/trackStore';
import { type TransportState } from '#/modules/Transport/useCases/transportQueries';
import { type AutomationStoreState } from '#/modules/Automation/stores/automationStore';
import { type MidiStoreState } from '#/modules/MIDI/stores/midiStore';
import { type TempoMapStoreState } from '#/modules/Transport/stores/tempoMapStore';
import { type TimeSignatureMapStoreState } from '#/modules/Transport/stores/timeSignatureMapStore';
import { type MarkerStoreState } from '#/modules/Arrangement/stores/markerStore';
import { type TakeLaneStoreState } from '#/modules/Arrangement/stores/takeLaneStore';
import { type SidechainRoute } from '#/modules/Routing/useCases/sidechain';

export type ArrangementData = {
    id: string;
    name: string;
    tracks: TrackStoreState;
    automation: AutomationStoreState;
    midi: MidiStoreState;
    tempoMap?: TempoMapStoreState;
    timeSignatureMap?: TimeSignatureMapStoreState;
    markers?: MarkerStoreState;
    takeLanes?: TakeLaneStoreState;
};

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

    // New arrangement fields
    arrangements?: ArrangementData[];
    activeArrangementId?: string;
};

export const PROJECT_STORAGE_KEY = 'sourdaw-project';
export const RECENT_PROJECTS_KEY = 'sourdaw:recent-projects';
