import { restoreArrangementMetadataSnapshot, restoreTrackSnapshot } from '#/modules/Arrangement/useCases';
import { restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { restoreTimelineMapSnapshot } from '#/modules/Transport/useCases';

import { type ArrangementSnapshot } from '../../stores/arrangementStore';

export function loadSnapshot(data: ArrangementSnapshot): void {
    restoreTrackSnapshot(data.tracks);
    restoreAutomationSnapshot(data.automation);
    const midiState: ArrangementSnapshot['midi'] = {
        notesByClipId: data.midi.notesByClipId,
        ccByClipId: data.midi.ccByClipId,
        pitchBendByClipId: data.midi.pitchBendByClipId,
    };
    // A stamped snapshot restores a stamped store; absence restores the
    // unstamped state legacy snapshots keep their meaning under.
    if (data.midi.noteCoordinateFormat !== undefined) {
        midiState.noteCoordinateFormat = data.midi.noteCoordinateFormat;
    }
    setMidiStoreState(midiState);
    restoreTimelineMapSnapshot({
        tempoMap: data.tempoMap,
        timeSignatureMap: data.timeSignatureMap,
    });
    restoreArrangementMetadataSnapshot({
        markers: data.markers,
        takeLanes: data.takeLanes,
    });
}
