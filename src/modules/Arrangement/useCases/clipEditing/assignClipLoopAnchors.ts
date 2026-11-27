import { type Clip } from '../../models/Track';

import { type ClipPlacement } from './readClipPlacement';

/** Writes the placement's loop anchors onto the clip; clip objects hold an anchor either present or absent, never `undefined`. */
export function assignClipLoopAnchors(clip: Clip, placement: ClipPlacement): void {
    if (placement.loopOriginBeat === undefined) {
        delete clip.loopOriginBeat;
    } else {
        clip.loopOriginBeat = placement.loopOriginBeat;
    }
    if (placement.audioLoopPassOriginBeat === undefined) {
        delete clip.audioLoopPassOriginBeat;
    } else {
        clip.audioLoopPassOriginBeat = placement.audioLoopPassOriginBeat;
    }
}
