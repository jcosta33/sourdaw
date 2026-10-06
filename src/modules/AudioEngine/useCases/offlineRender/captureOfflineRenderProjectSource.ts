import { gainEnvelopeStore, getVcaGroupsState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { chordTrackStore, grooveTemplateStore, midiStore } from '#/modules/MIDI/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { type YeastProcessorInfo } from '#/modules/Yeast/stores';

import { offlineRenderCapturePorts } from './offlineRenderCapturePorts';
import { type OfflineRenderProjectSource } from './OfflineRenderSource';

/** Runs `read` with the CRDT-backed stores answering for one document, and returns what it read. */
type DocumentReader = <Result>(read: () => Result) => Result;

type DocumentReadModels = Omit<OfflineRenderProjectSource, 'yeastProcessorsByDevice'>;

function readLiveDocument<Result>(read: () => Result): Result {
    return read();
}

function readDocumentModels(): DocumentReadModels {
    return structuredClone({
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
    });
}

/**
 * Every Yeast device the tracks hold, with its rack; a device with no rack of its own reads as
 * empty. The rack is read through the owner's capture port, so loading this module loads no
 * Yeast store and none of its load-time subscriptions.
 */
function readYeastRacks(tracks: DocumentReadModels['tracks']): Record<string, YeastProcessorInfo[]> {
    const racks: Record<string, YeastProcessorInfo[]> = {};
    for (const track of tracks?.tracks ?? []) {
        for (const device of track.devices) {
            if (device.type === 'yeast') {
                const rack = offlineRenderCapturePorts.yeastRacks?.readRack(device.id) ?? [];
                racks[device.id] = rack.map((processor) => structuredClone(processor));
            }
        }
    }
    return racks;
}

/**
 * Every owner read model an offline render needs, detached from the stores
 * that produced it, ready for `captureOfflineRenderInput` or
 * `renderTrackSubgraphOffline` as their supplied document.
 *
 * `readDocument` decides which document the CRDT-backed stores answer for: the
 * live project by default, or an isolated command preview through its
 * synchronous `scope`. It must run `read` synchronously and return its result.
 *
 * Yeast racks are the one read kept outside `readDocument`. The Yeast adapter
 * decodes a slot into adapter-held state and rebinds its active-rack view to
 * the device the current tracks resolve (`createYeastAutomergeStorage`), so a
 * decode redirected into another document rewrites what the live session's
 * Yeast view holds; and a rack read for any device other than the active one
 * comes from that adapter-held state, which a redirect never reaches. A rack
 * is keyed by its device id and no isolated-preview command writes the Yeast
 * slot, so the live racks are the supplied document's racks; a device only the
 * supplied document holds has no rack, which is the empty rack a new Yeast
 * device starts with.
 */
export function captureOfflineRenderProjectSource(
    readDocument: DocumentReader = readLiveDocument
): OfflineRenderProjectSource {
    const document = readDocument(readDocumentModels);
    return { ...document, yeastProcessorsByDevice: readYeastRacks(document.tracks) };
}
