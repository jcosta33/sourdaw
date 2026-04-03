import { type TrackStoreState } from '#/modules/Arrangement/stores/trackStore';
import { type TransportState } from '#/modules/Transport/useCases/transportQueries';
import { type AutomationStoreState } from '#/modules/Automation/stores/automationStore';
import { type MidiStoreState } from '#/modules/MIDI/stores/midiStore';
import { type TempoMapStoreState } from '#/modules/Transport/stores/tempoMapStore';
import { type TimeSignatureMapStoreState } from '#/modules/Transport/stores/timeSignatureMapStore';
import { type MarkerStoreState } from '#/modules/Arrangement/stores/markerStore';
import { type TakeLaneStoreState } from '#/modules/Arrangement/stores/takeLaneStore';
import { type SidechainRoute } from '#/modules/Routing/useCases/sidechain';
import { type ExportedAudioBuffer } from '#/modules/AudioEngine/stores/audioBufferCache';

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

    /** Audio buffer data embedded for portability. Keyed by audioBufferId.
     * Present when the project was exported with "include audio" (the default).
     * Absent in legacy files — those rely on the local IDB cache instead. */
    audioBuffers?: Record<string, ExportedAudioBuffer>;
};

export const RECENT_PROJECTS_KEY = 'sourdaw:recent-projects';
