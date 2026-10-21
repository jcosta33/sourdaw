import { updateClip } from '../../repositories/track/updateClip';

/**
 * Enabling the loop (re)establishes the loop anchor at the clip's current
 * placement (#4988): the region the loop covers is what the musician sees now,
 * so the pass count and the loop window measure from here. Disabling and
 * clearing leave any existing anchor in place — it is inert while the loop is
 * off, and a later enable restamps it.
 *
 * `anchorBeat` is the restore leg's exact-anchor form (#5198): undoing a loop
 * edit must put the pre-action anchor state back, not derive it — a recorded
 * value restores that anchor, `null` records a clip that carried none and
 * removes the key the forward action minted (an enable undone on a
 * never-looped clip must leave no anchor behind, or an older state restore
 * captured anchorless conflicts and bricks the undo stack). Absent keeps
 * today's law: a fresh user enable restamps at the live start, and a legacy
 * restore entry replays exactly the restamp it always did.
 */
export function setClipLoop(clipId: string, enabled: boolean | undefined, anchorBeat?: number | null): boolean {
    // A non-finite anchor is corrupted data, not an anchor state (#5198): a
    // persisted `1e999` decodes as Infinity, and writing it into clip state
    // derives a NaN loop window in every reader. Drop it to the absent form —
    // exactly the behavior a payload without the field gets.
    const restoreAnchorBeat = anchorBeat !== null && !Number.isFinite(anchorBeat) ? undefined : anchorBeat;
    return updateClip(clipId, (context) => {
        const updatedClip = { ...context };
        if (enabled === undefined) {
            delete updatedClip.loopEnabled;
        } else {
            updatedClip.loopEnabled = enabled;
        }
        if (restoreAnchorBeat === undefined) {
            // The fresh-enable restamp law.
            if (enabled === true) {
                updatedClip.loopOriginBeat = context.startBeat;
            }
        } else if (restoreAnchorBeat === null) {
            delete updatedClip.loopOriginBeat;
        } else {
            updatedClip.loopOriginBeat = restoreAnchorBeat;
        }
        return updatedClip;
    });
}
