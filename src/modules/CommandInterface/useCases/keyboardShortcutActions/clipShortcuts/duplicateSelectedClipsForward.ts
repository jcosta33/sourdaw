import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { prepareDuplicateClipTargetId, setClipSelection } from '#/modules/Arrangement/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

type ClipPlacement = {
    clipId: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
};

/** The selected clips with the placement data a copy needs, in track order. */
function collectSelectedClips(tracks: readonly Track[], selectedClipIds: readonly string[]): ClipPlacement[] {
    const selected: ClipPlacement[] = [];
    for (const track of tracks) {
        for (const clip of track.clips) {
            if (!selectedClipIds.includes(clip.id)) {
                continue;
            }
            selected.push({ clipId: clip.id, trackId: track.id, startBeat: clip.startBeat, endBeat: clip.endBeat });
        }
    }
    return selected;
}

/**
 * Duplicates all selected clips forward by the selection's total time span (R-B2).
 *
 * Selection span = latestEnd - earliestStart.
 * All clips are offset forward by that span.
 * The copies become the selection once the batch commits, so each press adds the next copy
 * immediately after the previous; a refused or failed batch leaves the selection alone.
 *
 * Each copy is one `duplicateClipAt` in a single batch, so every copy carries what a
 * single duplicate carries and one undo step removes them all.
 */
export async function duplicateSelectedClipsForward(selectedClipIds: readonly string[]): Promise<void> {
    if (selectedClipIds.length === 0) {
        return;
    }

    const state = trackStore.value;
    if (!state) {
        return;
    }

    const selected = collectSelectedClips(state.tracks, selectedClipIds);
    if (selected.length === 0) {
        return;
    }

    const earliestStart = Math.min(...selected.map((clip) => clip.startBeat));
    const latestEnd = Math.max(...selected.map((clip) => clip.endBeat));
    const span = latestEnd - earliestStart;

    if (span <= 0) {
        return;
    }

    // The caller names each copy so the selection can move to exactly the clips this batch creates.
    const copyIds = selected.map(() => prepareDuplicateClipTargetId());
    const actions: AppAction[] = selected.map((clip, index) => ({
        type: 'duplicateClipAt',
        payload: {
            clipId: clip.clipId,
            destinationTrackId: clip.trackId,
            startBeat: clip.startBeat + span,
            targetClipId: copyIds[index],
        },
    }));
    const result = await executeAppActionBatch(actions, {
        groupId: `duplicate-clips-forward-${crypto.randomUUID()}`,
        groupLabel: `Duplicate ${actions.length} clip${actions.length > 1 ? 's' : ''} forward`,
        source: 'manual',
    });

    // A refusal is the user's to see; a handler failure is a defect and propagates.
    if (result.status === 'rejected' || result.status === 'conflicted') {
        notifyUser(`Duplicate clips forward was refused: ${result.reason}`, 'warning');
        return;
    }
    if (result.status === 'failed' || result.status === 'cancelled') {
        throw new Error(`Duplicate clips forward failed: ${result.reason}`);
    }
    if (result.status === 'no-op' || result.status === 'ambiguous') {
        return;
    }
    // The copies become the selection, so the next press chains after them.
    setClipSelection(copyIds);
}
