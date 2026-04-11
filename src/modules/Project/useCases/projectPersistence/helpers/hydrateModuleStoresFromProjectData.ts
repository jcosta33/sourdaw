import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation';
import { midiStore } from '#/modules/MIDI/stores';
import { setSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { type ProjectData } from '../../../models/ProjectData';

export function hydrateModuleStoresFromProjectData(data: ProjectData): void {
    trackStore.set(data.tracks);
    transportStore.set({
        ...defaultTransportState,
        ...data.transport,
    });
    if (data.automation) {
        automationStore.set(data.automation);
    }
    if (data.midi) {
        midiStore.set(data.midi);
    }
    if (data.tempoMap) {
        tempoMapStore.set(data.tempoMap);
    }
    if (data.timeSignatureMap) {
        timeSignatureMapStore.set(data.timeSignatureMap);
    }
    if (data.markers) {
        markerStore.set(data.markers);
    }
    if (data.takeLanes) {
        takeLaneStore.set(data.takeLanes);
    }
    if (data.sidechainRoutes && data.sidechainRoutes.length > 0) {
        setSidechainRoutes(data.sidechainRoutes);
    }
}