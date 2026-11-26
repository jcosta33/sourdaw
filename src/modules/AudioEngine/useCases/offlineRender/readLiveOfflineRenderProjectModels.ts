import { gainEnvelopeStore, getVcaGroupsState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { chordTrackStore, grooveTemplateStore, midiStore } from '#/modules/MIDI/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';

import { type OfflineRenderProjectSource } from './OfflineRenderSource';

export type OfflineRenderDocumentModels = Omit<OfflineRenderProjectSource, 'yeastProcessorsByDevice'>;

/**
 * The live owner read models a render reads, not detached: a caller that only compares them (a
 * freeze's staleness check) reads them here without copying the project; a render takes the copy
 * `captureOfflineRenderProjectSource` makes.
 */
export function readLiveOfflineRenderProjectModels(): OfflineRenderDocumentModels {
    return {
        tracks: trackStore.value,
        midi: midiStore.value,
        transport: transportStore.value,
        tempoMap: tempoMapStore.value,
        timeSignatureMap: timeSignatureMapStore.value,
        automationLanes: automationStore.value?.lanes ?? [],
        takeLanes: takeLaneStore.value,
        gainEnvelopes: gainEnvelopeStore.value?.envelopes ?? {},
        sidechainRoutes: sidechainStore.value?.routes ?? [],
        vcaGroups: getVcaGroupsState(),
        grooveTemplates: grooveTemplateStore.value,
        chordTrack: chordTrackStore.value,
    };
}
