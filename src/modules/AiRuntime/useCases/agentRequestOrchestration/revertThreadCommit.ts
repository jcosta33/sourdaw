import { undoHistoryStore } from '#/modules/Command/stores';

import { aiActionHistoryStore } from '../../stores/aiActionHistoryStore';
import { revertAiActionGroup } from '../aiHistoryActions';

type ThreadCommitRevert = { status: 'reverted'; labels: string[] } | { status: 'refused'; reason: string };

/**
 * Undoes a thread commit's whole revert group through the AI history's group revert, the route its
 * panel uses. The group is read again here, after planning, so a commit that an undo, a redo or a
 * later edit moved since the plan was made is refused rather than partly undone.
 */
export async function revertThreadCommit(revertGroupId: string): Promise<ThreadCommitRevert> {
    const history = undoHistoryStore.value;
    const applied = (history?.past ?? []).some((entry) => entry.groupId === revertGroupId);
    const redoable = (history?.future ?? []).some((entry) => entry.groupId === revertGroupId);
    if (!applied || redoable) {
        return {
            status: 'refused',
            reason: 'The last committed change no longer stands as it was committed, so nothing was undone.',
        };
    }
    const group = aiActionHistoryStore.value?.groups.find(
        (candidate) => candidate.groupId === revertGroupId && candidate.executionKind !== 'runtime'
    );
    if (group === undefined) {
        return {
            status: 'refused',
            reason: 'The AI history no longer holds the last committed change, so nothing was undone.',
        };
    }
    await revertAiActionGroup(group);
    return { status: 'reverted', labels: group.actions.map((action) => action.label) };
}
