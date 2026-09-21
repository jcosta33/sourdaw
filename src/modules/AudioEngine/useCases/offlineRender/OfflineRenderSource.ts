import {
    type TrackStoreState,
    type TakeLaneStoreState,
    type GainEnvelopeStoreState,
    type VcaGroupState,
} from '#/modules/Arrangement/stores';
import { type AutomationStoreState } from '#/modules/Automation/stores';
import { type MidiStoreState, type GrooveTemplateState, type ChordTrackState } from '#/modules/MIDI/stores';
import { type externalPluginParameterStore } from '#/modules/PluginHost/stores';
import { type sidechainStore } from '#/modules/Routing/stores';
import {
    type TransportState,
    type TempoMapStoreState,
    type TimeSignatureMapStoreState,
} from '#/modules/Transport/stores';
import { type workspaceStore } from '#/modules/WorkspaceShell/stores';
import { type YeastProcessorInfo } from '#/modules/Yeast/stores';

export type OfflineAudioBufferSource = Readonly<{
    get(id: string): AudioBuffer | undefined;
}>;

/** One document's owner read models. Null/empty values are authoritative, never live fallbacks. */
export type OfflineRenderProjectSource = {
    tracks: TrackStoreState | null;
    midi: MidiStoreState | null;
    transport: TransportState | null;
    tempoMap: TempoMapStoreState | null;
    timeSignatureMap: TimeSignatureMapStoreState | null;
    automationLanes: NonNullable<AutomationStoreState>['lanes'];
    takeLanes: TakeLaneStoreState | null;
    gainEnvelopes: GainEnvelopeStoreState['envelopes'];
    sidechainRoutes: NonNullable<typeof sidechainStore.value>['routes'];
    vcaGroups: VcaGroupState['groups'];
    grooveTemplates: GrooveTemplateState | null;
    chordTrack: ChordTrackState | null;
    yeastProcessorsByDevice: Readonly<Record<string, readonly YeastProcessorInfo[]>>;
};

/** Runtime/asset facts are separate from document truth and can be captured for a supplied document. */
export type OfflineRenderRuntimeSource = {
    buffers: OfflineAudioBufferSource;
    deviceLatencyMs: ReadonlyMap<string, number>;
    loadedExternalInstanceIds: ReadonlySet<string>;
    externalPluginParameters: typeof externalPluginParameterStore.value;
    calibrationByDevice: ReadonlyMap<string, Readonly<Record<string, number>> | null>;
    soloMode: NonNullable<typeof workspaceStore.value>['soloMode'];
};
