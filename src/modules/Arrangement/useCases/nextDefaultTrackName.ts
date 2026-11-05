import { nextDefaultTrackName as readNextDefaultTrackName } from '../models/DefaultTrackName';
import { type TrackKind } from '../models/Track';

/**
 * The name `addTrack` gives a nameless track of `kind` beside `tracks`: the
 * kind's label and one more than the highest default number among them. A
 * planner that projects a batch's tracks before it runs reads it here, so the
 * name it pins is the one the track owner would assign. The shapes are
 * structural so foreign modules keep their own track types.
 */
export function nextDefaultTrackName(
    kind: TrackKind,
    tracks: readonly { readonly kind: string; readonly name: string }[]
): string {
    return readNextDefaultTrackName(kind, tracks);
}
