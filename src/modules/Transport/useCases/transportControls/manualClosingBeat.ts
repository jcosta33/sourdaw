import { type ManualRecordingEnd } from './captureManualRecordingEnd';

/**
 * The beat a manual ending closes clips and takes on. The scheduler fires a
 * punch-out on the first tick that reaches it, so a gesture between the audio
 * crossing and that tick reads a beat past the region; it closes where the
 * punch-out would have. A parked receipt has no live beat to give.
 */
export function manualClosingBeat(ending: ManualRecordingEnd): number | undefined {
    if (!ending?.rolling) {
        return undefined;
    }
    const gestureBeat = ending.beatAtContextSeconds(ending.contextSeconds);
    return ending.punchOutBeat === null ? gestureBeat : Math.min(gestureBeat, ending.punchOutBeat);
}
