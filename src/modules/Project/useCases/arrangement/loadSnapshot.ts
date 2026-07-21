import { restoreArrangementMetadataSnapshot, restoreTrackSnapshot } from '#/modules/Arrangement/useCases';
import { restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { restoreTimelineMapSnapshot } from '#/modules/Transport/useCases';

import { type ArrangementSnapshot } from '../../stores/arrangementStore';

export function loadSnapshot(data: ArrangementSnapshot): void {
    restoreTrackSnapshot(data.tracks);
    restoreAutomationSnapshot(data.automation);
    setMidiStoreState({
        notesByClipId: data.midi.notesByClipId,
        ccByClipId: data.midi.ccByClipId,
        pitchBendByClipId: data.midi.pitchBendByClipId,
    });
    restoreTimelineMapSnapshot({
        tempoMap: data.tempoMap,
        timeSignatureMap: data.timeSignatureMap,
    });
    restoreArrangementMetadataSnapshot({
        markers: data.markers,
        takeLanes: data.takeLanes,
    });
}
