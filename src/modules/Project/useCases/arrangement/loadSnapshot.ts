import { markerStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { restoreTrackSnapshot } from '#/modules/Arrangement/useCases';
import { restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';

import { type ArrangementSnapshot } from '../../stores/arrangementStore';

import {
    emptySnapshotMarkers,
    emptySnapshotTakeLanes,
    emptySnapshotTempoMap,
    emptySnapshotTimeSignatureMap,
} from './helpers';

export function loadSnapshot(data: ArrangementSnapshot): void {
    restoreTrackSnapshot(data.tracks);
    restoreAutomationSnapshot(data.automation);
    setMidiStoreState(data.midi);
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
