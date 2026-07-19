import { revertActionGroup } from '#/modules/Command/useCases';

import { type AiActionGroup, markGroupReverted } from '../stores/aiActionHistoryStore';

export async function revertAiActionGroup(group: AiActionGroup): Promise<void> {
    // Reverting an AI action group is an undo-store mutation owned by the Command
    // module — delegate to its `revertActionGroup` use-case rather than rebuilding
    // the past/future split (and undo-tree position) by hand.
    const reverted = await revertActionGroup(group.groupId);
    if (reverted) {
        markGroupReverted(group.groupId);
    }
}
