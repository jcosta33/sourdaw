import { getPrecedingBars, type TimeSignatureChange } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';

type RollStartInput = Pick<
    TransportState,
    'playheadPosition' | 'preRollEnabled' | 'preRollBars' | 'timeSignatureNumerator' | 'timeSignatureDenominator'
>;

/**
 * The beat a transport started from `state` actually rolls from: the playhead,
 * or the opening of the pre-roll when one is enabled. Playback and the take it
 * may carry share this so the take is placed against the beat the capture
 * really began on.
 *
 * Pre-roll is a count of *bars* before the play point, so its length has to
 * come from the meter governing those bars. Multiplying the transport
 * numerator by the bar count read neither the time-signature map nor the
 * denominator, so a project with a meter change — or any meter that is not
 * x/4 — rolled in from the wrong beat.
 */
export function resolveRollStartBeat(
    state: RollStartInput,
    timeSignatureChanges: readonly TimeSignatureChange[]
): number {
    if (!state.preRollEnabled || state.preRollBars <= 0) {
        return state.playheadPosition;
    }
    const preRollBars = getPrecedingBars(
        timeSignatureChanges,
        state.playheadPosition,
        state.preRollBars,
        state.timeSignatureNumerator,
        state.timeSignatureDenominator
    );
    // `preRollBars > 0` is guarded above, so there is always a bar here.
    return Math.max(0, preRollBars[0]!.startBeat);
}
