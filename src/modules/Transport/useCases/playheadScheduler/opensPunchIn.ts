import { trackStore } from '#/modules/Arrangement/stores';

import { isTakeTargetTrack } from '../transportControls/isTakeTargetTrack';

import { schedulerSession } from './schedulerSession';

import type { TransportState } from '../../models/TransportState';

type PunchInTransport = Pick<TransportState, 'punchInEnabled' | 'isRecording' | 'punchInBeat' | 'punchOutBeat'>;

/**
 * Whether a scheduler window scanned at `scanBeat` opens an automatic punch-in:
 * the region is enabled and well formed, a take can start on an armed track, nothing is recording
 * yet, and the beat lies inside the region.
 */
export function opensPunchIn(transport: PunchInTransport, scanBeat: number): boolean {
    return (
        transport.punchInEnabled &&
        !transport.isRecording &&
        !schedulerSession.punchRecordingActive &&
        (trackStore.value?.tracks.some(isTakeTargetTrack) ?? false) &&
        transport.punchInBeat < transport.punchOutBeat &&
        scanBeat >= transport.punchInBeat &&
        // Upper bound. Without it, starting playback past the region fires
        // punch-in and punch-out on the same tick: a full-width clip and
        // take are stamped across [punchInBeat, punchOutBeat) and captured
        // nothing. Punching in only makes sense while the region is still
        // ahead of the tick's end.
        scanBeat < transport.punchOutBeat
    );
}
