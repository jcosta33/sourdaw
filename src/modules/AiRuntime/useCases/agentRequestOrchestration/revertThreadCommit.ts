import { revertActionGroupAtomically } from '#/modules/Command/useCases';

import { aiActionHistoryStore, markGroupReverted } from '../../stores/aiActionHistoryStore';

type ThreadCommitRevert =
    { status: 'reverted'; labels: string[]; warning: string | null } | { status: 'refused'; reason: string };

type GroupRefusal = Extract<Awaited<ReturnType<typeof revertActionGroupAtomically>>, { status: 'refused' }>;

function describeRefusal(refusal: GroupRefusal): string {
    switch (refusal.reason) {
        case 'not-applied':
            return 'The last committed change no longer stands as it was committed, so nothing was undone.';
        case 'not-replayable':
            return 'Part of the last committed change has no command that undoes it, so nothing was undone.';
        case 'conflict':
            return `The project has changed since the last committed change, so it cannot be undone as a whole (${refusal.detail}); nothing was undone.`;
        default: {
            const exhaustive: never = refusal.reason;
            throw new Error(`Unsupported group revert refusal: ${String(exhaustive)}`);
        }
    }
}

/**
 * Undoes a thread commit's whole revert group as one atomic replay, and marks its AI history group
 * reverted as the panel's revert does. The group is read again when the replay runs, so a commit
 * that an undo, a redo or a later edit moved since the plan was made, or one any inverse of which
 * conflicts with the project as it is now, is refused with nothing undone rather than partly undone.
 * `shouldExecute` is asked last before the replay writes, so a run cancelled before then writes nothing.
 */
export async function revertThreadCommit(
    revertGroupId: string,
    shouldExecute?: () => boolean
): Promise<ThreadCommitRevert> {
    const group = aiActionHistoryStore.value?.groups.find(
        (candidate) => candidate.groupId === revertGroupId && candidate.executionKind !== 'runtime'
    );
    if (group === undefined) {
        return {
            status: 'refused',
            reason: 'The AI history no longer holds the last committed change, so nothing was undone.',
        };
    }
    const reverted = await revertActionGroupAtomically(revertGroupId, { shouldExecute });
    if (reverted.status === 'refused') {
        return { status: 'refused', reason: describeRefusal(reverted) };
    }
    markGroupReverted(revertGroupId);
    return {
        status: 'reverted',
        labels: group.actions.map((action) => action.label),
        warning: reverted.warning,
    };
}
