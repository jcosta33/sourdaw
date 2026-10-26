import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { declareRegisteredStateInBuffer } from './declareRegisteredStateInBuffer';

/**
 * Give the take that just ended, where it recorded into a clip an earlier take already holds rows in,
 * the registered-parameter declarations that keep each take's bends and parameter rows under the state
 * that was live when that take recorded them (`interleaveRegisteredStateDeclarations`).
 *
 * This is the take into a clip carried over from an earlier take still waiting for its commit, whose
 * earlier rows are the stored ones, that take's seed and the start of the shared buffer. The take's own
 * state in this clip starts from what the input held when the take first recorded into it
 * (`registeredStateAtFirstRow`). The declarations go into the take's buffered rows, so the commit and its
 * redo snapshot carry them with the same ids. An overdub into an existing clip declares when its pass lands
 * (`landOverdubPass`), against the rows the clip holds by then.
 */
export function declareOverdubRegisteredState(clipId: string): void {
    const { buffers, carriedOverClips, bendRangeSeeds } = recordedControllerTakeState;
    const buffer = buffers.get(clipId);
    if (!buffer) {
        return;
    }
    const carriedOver = carriedOverClips.get(clipId);
    declareRegisteredStateInBuffer({
        clipId,
        buffer,
        takeStart: carriedOver ?? { cc: 0, pitchBend: 0 },
        seedRows: carriedOver ? (bendRangeSeeds.get(clipId) ?? []) : [],
    });
}
