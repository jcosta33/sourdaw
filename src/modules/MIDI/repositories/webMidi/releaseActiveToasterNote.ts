import type { GetWebMidiTrackStrip } from './engineStripAccess';
import type { ActiveNoteData } from '../../models/WebMidiTypes';

export function releaseActiveToasterNote(noteData: ActiveNoteData, getTrackStrip: GetWebMidiTrackStrip): void {
    const route = noteData.toasterRoute;
    if (!route) {
        return;
    }

    delete noteData.toasterRoute;
    const strip = getTrackStrip(noteData.instrumentTrackId);
    const deviceNode = strip?.deviceNodes.find((candidate) => candidate.deviceId === route.deviceId);
    deviceNode?.toasterControls?.noteOff(route.pad);
}
