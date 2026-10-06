import { type Take } from '../models/TakeLane';
import { type Clip } from '../stores/trackStore';

import { clipMediaOriginBeat } from './clipMediaOriginBeat';

/**
 * The media a take plays, as one law for every consumer.
 *
 * A take that names `sourceOffsetBeats` is a loop-recorded pass: it places the
 * material that begins that deep into the recording's media at its own
 * `startBeat`, so its origin is measured from the take, not from the clip.
 * Recording commit rebases the offset onto the media origin, which is what makes
 * that origin the same instant the clip's own offset names. A take without one
 * plays the clip's media as the clip places it.
 *
 * `earliestBeat` is the first beat the take can sound. A pass cannot sound
 * before its media exists; any other take cannot sound before its clip.
 * `sourceStartBeat` carries the loop-occurrence count for probability rolls.
 */
export function resolveTakeMedia(
    take: Pick<Take, 'startBeat' | 'sourceOffsetBeats'>,
    clip: Clip
): { originBeat: number; earliestBeat: number; sourceStartBeat: number } {
    if (take.sourceOffsetBeats === undefined) {
        return {
            originBeat: clipMediaOriginBeat(clip),
            earliestBeat: clip.startBeat,
            sourceStartBeat: clip.startBeat,
        };
    }
    const originBeat = take.startBeat - take.sourceOffsetBeats;
    return { originBeat, earliestBeat: originBeat, sourceStartBeat: originBeat };
}
