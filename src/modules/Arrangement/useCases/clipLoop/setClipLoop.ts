import { updateClip } from '../../repositories/track/updateClip';

/**
 * Enabling the loop (re)establishes the loop anchor at the clip's current
 * placement (#4988): the region the loop covers is what the musician sees now,
 * so the pass count and the loop window measure from here. Disabling and
 * clearing leave any existing anchor in place — it is inert while the loop is
 * off, and a later enable restamps it.
 *
 * `anchorBeat` is the restore leg's exact-anchor form (#5198): undoing a loop
 * disable must put the pre-disable anchor back, not restamp at the live start,
 * so the recorded inverse carries the anchor it captured. A fresh user enable
 * passes nothing and keeps the restamp law; a legacy restore entry carries no
 * anchor and replays exactly the restamp it always did.
 */
export function setClipLoop(clipId: string, enabled: boolean | undefined, anchorBeat?: number): boolean {
    return updateClip(clipId, (context) => {
        const updatedClip = { ...context };
        if (enabled === undefined) {
            delete updatedClip.loopEnabled;
        } else {
            updatedClip.loopEnabled = enabled;
            if (enabled === true) {
                updatedClip.loopOriginBeat = anchorBeat ?? context.startBeat;
            }
        }
        return updatedClip;
    });
}
