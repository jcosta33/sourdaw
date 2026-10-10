import { updateClip } from '../../repositories/track/updateClip';

/**
 * Enabling the loop (re)establishes the loop anchor at the clip's current
 * placement (#4988): the region the loop covers is what the musician sees now,
 * so the pass count and the loop window measure from here. Disabling and
 * clearing leave any existing anchor in place — it is inert while the loop is
 * off, and a later enable restamps it.
 */
export function setClipLoop(clipId: string, enabled: boolean | undefined): boolean {
    return updateClip(clipId, (context) => {
        const updatedClip = { ...context };
        if (enabled === undefined) {
            delete updatedClip.loopEnabled;
        } else {
            updatedClip.loopEnabled = enabled;
            if (enabled === true) {
                updatedClip.loopOriginBeat = context.startBeat;
            }
        }
        return updatedClip;
    });
}
