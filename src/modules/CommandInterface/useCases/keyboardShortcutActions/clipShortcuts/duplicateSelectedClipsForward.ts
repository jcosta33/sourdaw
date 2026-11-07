import { logger } from '#/infra/logger/appLogger';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { prepareDuplicateClipTargetId, setClipSelection } from '#/modules/Arrangement/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

type ClipDuplicateAuthority = { shouldExecute: () => boolean; onSelected: () => void };
type ClipDuplicateBatchResult = Awaited<ReturnType<typeof executeAppActionBatch>>;

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

function finishClipDuplicateBatch(
    result: ClipDuplicateBatchResult,
    copyIds: string[],
    authority?: ClipDuplicateAuthority
): boolean {
    // A refusal is the user's to see; a handler failure is a defect and propagates.
    if (result.status === 'rejected' || result.status === 'conflicted') {
        notifyUser(`Duplicate clips forward was refused: ${result.reason}`, 'warning');
        return false;
    }
    if (result.status === 'cancelled' && authority && !authority.shouldExecute()) {
        return false;
    }
    if (result.status === 'failed' || result.status === 'cancelled') {
        throw new Error(`Duplicate clips forward failed: ${result.reason}`);
    }
    if (result.status === 'ambiguous') {
        logger.error(new Error(`Duplicate clips forward has an uncertain committed outcome: ${result.reason}`));
    }
    if (result.status === 'no-op' || (authority && !authority.shouldExecute())) {
        return false;
    }
    if (result.status === 'ambiguous') {
        const existingIds = new Set(trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
        const committedCopyIds = copyIds.filter((id) => existingIds.has(id));
        if (committedCopyIds.length === 0) {
            return false;
        }
        setClipSelection(committedCopyIds);
        authority?.onSelected();
        // An incomplete witness can select known copies, but cannot continue the older chain.
        return committedCopyIds.length === copyIds.length;
    }
    setClipSelection(copyIds);
    authority?.onSelected();
    return true;
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
export async function duplicateSelectedClipsForward(
    selectedClipIds: readonly string[],
    authority?: ClipDuplicateAuthority
): Promise<boolean> {
    if (selectedClipIds.length === 0) {
        return false;
    }

    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const selected = collectSelectedClips(state.tracks, selectedClipIds);
    if (selected.length === 0) {
        return false;
    }

    const earliestStart = Math.min(...selected.map((clip) => clip.startBeat));
    const latestEnd = Math.max(...selected.map((clip) => clip.endBeat));
    const span = latestEnd - earliestStart;

    if (span <= 0) {
        return false;
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
    const options: ExecuteOptions = {
        groupId: `duplicate-clips-forward-${crypto.randomUUID()}`,
        groupLabel: `Duplicate ${actions.length} clip${actions.length > 1 ? 's' : ''} forward`,
        source: 'manual',
    };
    if (authority) {
        options.shouldExecute = authority.shouldExecute;
    }
    const result = await executeAppActionBatch(actions, options);

    return finishClipDuplicateBatch(result, copyIds, authority);
}
