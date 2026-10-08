import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTrackState } from '../../repositories/track/getTrackState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

import { applyPreparedClipSplit } from './applyPreparedClipSplit';
import { prepareClipSplit } from './prepareClipSplit';
import { restoreClipSplitState } from './restoreClipSplitState';

function splitLineageIsAbsent(clipId: string, rightClipId: string): boolean {
    const state = getTrackState();
    if (
        !state ||
        resolveEligibleClipWriteTarget({ clipId }).status !== 'missing' ||
        resolveEligibleClipWriteTarget({ clipId: rightClipId }).status !== 'missing'
    ) {
        return false;
    }
    try {
        return state.tracks.every(
            (track) =>
                Array.isArray(track.alternatives) &&
                track.alternatives.every(
                    (alternative) =>
                        Array.isArray(alternative?.clips) &&
                        alternative.clips.every(
                            (clip) =>
                                clip !== null &&
                                typeof clip.id === 'string' &&
                                clip.id.length > 0 &&
                                clip.trackId === track.id &&
                                clip.id !== clipId &&
                                clip.id !== rightClipId
                        )
                )
        );
    } catch {
        return false;
    }
}

export function splitClipWithUndo(clipId: string, splitBeat: number): void {
    const plan = prepareClipSplit({ clipId, splitBeat });
    if (!plan) {
        return;
    }
    if (!applyPreparedClipSplit(plan)) {
        return;
    }
    const rightClipId = plan.rightClipId;
    const retiredTakeLanes: RetiredTakeLaneSnapshot[] = [];
    pushUndoEntry(
        'Split clip',
        () => {
            // A reverted creation group already removed this cut's lineage.
            // Advance callback history without restoring any of its project facets.
            if (splitLineageIsAbsent(clipId, rightClipId)) {
                return;
            }
            if (
                !restoreClipSplitState({
                    clipId,
                    rightClipId,
                    expected: plan.next,
                    replacement: plan.previous,
                    retiredTakeLanes,
                })
            ) {
                throw new Error('Cannot undo split clip: project state has changed');
            }
        },
        () => {
            if (
                !restoreClipSplitState({
                    clipId,
                    rightClipId,
                    expected: plan.previous,
                    replacement: plan.next,
                    retiredTakeLanes,
                })
            ) {
                const message = splitLineageIsAbsent(clipId, rightClipId)
                    ? 'Failed to redo split clip - the clip no longer spans the split beat'
                    : 'Failed to redo split clip - the clip state has changed';
                notifyUser(message, 'error');
                return REDO_NOT_APPLIED;
            }
            return rightClipId;
        }
    );
}
