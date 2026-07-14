import { markerStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { restoreTrackSnapshot } from '#/modules/Arrangement/useCases';
import { restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { restoreTimelineMapSnapshot } from '#/modules/Transport/useCases';

import { type ArrangementSnapshot } from '../../stores/arrangementStore';

import { emptySnapshotMarkers, emptySnapshotTakeLanes } from './helpers';

export function loadSnapshot(data: ArrangementSnapshot): void {
    restoreTrackSnapshot(data.tracks);
    restoreAutomationSnapshot(data.automation);
    setMidiStoreState(data.midi);
    restoreTimelineMapSnapshot({
        tempoMap: data.tempoMap,
        timeSignatureMap: data.timeSignatureMap,
    });
    // These two fields are optional on a snapshot but always live in shared
    // stores. When the target arrangement's snapshot omits one, reset that store
    // to empty rather than leaving the previous arrangement's value installed.
    markerStore.set(
        data.markers ?? {
            markers: [...emptySnapshotMarkers.markers],
            sections: [...emptySnapshotMarkers.sections],
        }
    );
    takeLaneStore.set(data.takeLanes ?? { lanes: [...emptySnapshotTakeLanes.lanes] });
}
