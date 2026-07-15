import { audioEngine } from '../createWebAudioEngine';

import type { ActiveNoteData } from '../../models/WebMidiTypes';

export function releaseActiveToasterNote(noteData: ActiveNoteData): void {
    const route = noteData.toasterRoute;
    if (!route) {
        return;
    }

    delete noteData.toasterRoute;
    const strip = audioEngine.getTrackStrip(noteData.instrumentTrackId);
    const deviceNode = strip?.deviceNodes.find((candidate) => candidate.deviceId === route.deviceId);
    deviceNode?.toasterControls?.noteOff(route.pad);
}
