import { captureEventPositionAt } from '#/modules/MIDI/useCases';
import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from '#/utils/clipLoopOrigin';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { schedulerSession } from '../playheadScheduler/schedulerSession';

import { captureRecordingEnd } from './captureRecordingEnd';

export type ManualRecordingEnd = ReturnType<typeof captureManualRecordingEnd>;

/** The punch-out the scheduler has yet to fire, read from the state its own punch-out check reads. */
function readPendingPunchOutBeat(): number | null {
    if (schedulerSession.automaticPunch) {
        return schedulerSession.automaticPunch.outBeat;
    }
    const transport = getTransportState();
    return schedulerSession.punchRecordingActive && transport?.punchInEnabled ? transport.punchOutBeat : null;
}

/**
 * The ending a user's stop closes on, read at the gesture: its clock receipt
 * and the punch-out still pending then. Pause retires the punch flag when it
 * parks, so the pending punch-out is read with the receipt, not after it.
 */
export function captureManualRecordingEnd() {
    const bound = schedulerSession.automaticPunch?.read();
    const now = captureRecordingEnd();
    let ending = now;
    if (now && bound && bound.status !== 'retired' && bound.status !== 'pending') {
        const position = captureEventPositionAt({ audioTime: now.contextSeconds });
        ending = { ...now, midiPosition: position };
        if (
            bound.status === 'bounded' &&
            (position.passIndex > bound.ending.midiPosition.passIndex ||
                (position.passIndex === bound.ending.midiPosition.passIndex &&
                    position.beat >= bound.ending.midiPosition.beat - CLIP_LOOP_WINDOW_BEAT_TOLERANCE))
        ) {
            ending = captureRecordingEnd(bound.ending);
        }
    }
    return ending && { ...ending, punchOutBeat: readPendingPunchOutBeat() };
}
