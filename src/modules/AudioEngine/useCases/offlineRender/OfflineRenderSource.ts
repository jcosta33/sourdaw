import {
    type TrackStoreState,
    type TakeLaneStoreState,
    type GainEnvelopeStoreState,
    type SoloMode,
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

/**
 * One processor of a Yeast rack, in AudioEngine's own words. Capture passes
 * racks through untouched: the composition root reads them from Yeast into
 * `configureOfflineYeastMidiProcessing`'s reader and hands them back to Yeast's
 * offline processor, so both crossings check this shape against Yeast's own.
 */
export type OfflineYeastProcessor = {
    id: string;
    type:
        | 'arpeggiator'
        | 'chord'
        | 'chordMemory'
        | 'scale'
        | 'harmonizer'
        | 'repeater'
        | 'velocity'
        | 'humanizer'
        | 'filter'
        | 'transposer'
        | 'groove'
        | 'ccGenerator'
        | 'euclidean'
        | 'markov'
        | 'mutation';
    name: string;
    bypassed: boolean;
    params?: Record<string, number>;
};

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
    yeastProcessorsByDevice: Readonly<Record<string, readonly OfflineYeastProcessor[]>>;
};

/** Runtime/asset facts are separate from document truth and can be captured for a supplied document. */
export type OfflineRenderRuntimeSource = {
    buffers: OfflineAudioBufferSource;
    deviceLatencyMs: ReadonlyMap<string, number>;
    loadedExternalInstanceIds: ReadonlySet<string>;
    externalPluginParameters: typeof externalPluginParameterStore.value;
    calibrationByDevice: ReadonlyMap<string, Readonly<Record<string, number>> | null>;
    soloMode: SoloMode;
};
