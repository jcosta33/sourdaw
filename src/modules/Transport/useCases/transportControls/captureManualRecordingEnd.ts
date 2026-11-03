import { getTransportState } from '../../repositories/transport/getTransportState';
import { schedulerSession } from '../playheadScheduler/schedulerSession';

import { captureRecordingEnd } from './captureRecordingEnd';

export type ManualRecordingEnd = ReturnType<typeof captureManualRecordingEnd>;

/** The punch-out the scheduler has yet to fire, read from the state its own punch-out check reads. */
function readPendingPunchOutBeat(): number | null {
    const transport = getTransportState();
    return schedulerSession.punchRecordingActive && transport?.punchInEnabled ? transport.punchOutBeat : null;
}

/**
 * The ending a user's stop closes on, read at the gesture: its clock receipt
 * and the punch-out still pending then. Pause retires the punch flag when it
 * parks, so the pending punch-out is read with the receipt, not after it.
 */
export function captureManualRecordingEnd() {
    const ending = captureRecordingEnd();
    return ending && { ...ending, punchOutBeat: readPendingPunchOutBeat() };
}
