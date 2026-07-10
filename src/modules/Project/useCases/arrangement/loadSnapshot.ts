import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { normalizeTrack } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';

import { type ArrangementSnapshot } from '../../stores/arrangementStore';

import {
    emptySnapshotMarkers,
    emptySnapshotTakeLanes,
    emptySnapshotTempoMap,
    emptySnapshotTimeSignatureMap,
} from './helpers';

export function loadSnapshot(data: ArrangementSnapshot): void {
    trackStore.set({
        ...data.tracks,
        tracks: data.tracks.tracks.map(normalizeTrack),
    });
    automationStore.set(data.automation);
    midiStore.set(data.midi);
    // These four fields are optional on a snapshot but always live in shared
    // stores. When the target arrangement's snapshot omits one, reset that store
    // to empty rather than leaving the previous arrangement's value installed.
    tempoMapStore.set(data.tempoMap ?? { changes: [...emptySnapshotTempoMap.changes] });
    timeSignatureMapStore.set(data.timeSignatureMap ?? { changes: [...emptySnapshotTimeSignatureMap.changes] });
    markerStore.set(
        data.markers ?? {
            markers: [...emptySnapshotMarkers.markers],
            sections: [...emptySnapshotMarkers.sections],
        }
    );
    takeLaneStore.set(data.takeLanes ?? { lanes: [...emptySnapshotTakeLanes.lanes] });
}
