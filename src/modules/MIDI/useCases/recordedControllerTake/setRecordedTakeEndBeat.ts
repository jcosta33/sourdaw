import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

type SetRecordedTakeEndBeatInput = {
    beat: number;
};

/**
 * Report the timeline beat a recording is stopping at, for the controller rows
 * of a take that records into a clip the recorder did not open.
 *
 * The recording finaliser knows it before it turns the transport's recording
 * flag off; by the time that falling edge is delivered a rolling stop has reset
 * the transport's own position. The take reads it once, at the edge.
 */
export function setRecordedTakeEndBeat({ beat }: SetRecordedTakeEndBeatInput): void {
    recordedControllerTakeState.takeEndBeat = Number.isFinite(beat) ? beat : null;
}
