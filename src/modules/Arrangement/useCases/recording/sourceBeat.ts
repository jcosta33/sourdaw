import { passSourceBeat } from './passSourceBeat';
import { recordingPassIndex } from './recordingPassIndex';

type EventPosition = { beat: number; passIndex: number };

/**
 * One admitted event's unwrapped position in the clip opened by this recording,
 * on the placement its pass fixed when it opened: the basis its take is staged on.
 */
export function sourceBeat(clipStartBeat: number, position: EventPosition): number | null {
    const pass = recordingPassIndex(position);
    return pass === null ? null : passSourceBeat(clipStartBeat, pass, position.beat);
}
