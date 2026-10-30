import { revertActionGroupAtomically } from '#/modules/Command/useCases';
import {
    captureProjectMutationAuthorization,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type AiActionGroup, markGroupReverted } from '../stores/aiActionHistoryStore';

export async function revertAiActionGroup(group: AiActionGroup): Promise<void> {
    if (group.executionKind === 'runtime') {
        return;
    }
    try {
        // Settle the already-visible writes before capturing authority. The check permits this
        // replay's own writes, but a replacement or outside edit while it waits revokes the click.
        settlePendingProjectWritesAndCaptureRevision();
        const shouldExecute = captureProjectMutationAuthorization();
        const result = await revertActionGroupAtomically(group.groupId, { shouldExecute });
        if (result.status === 'refused') {
            notifyUser(`AI change was not reverted. Nothing was undone. ${result.detail}`, 'warning');
            return;
        }
        markGroupReverted(group.groupId);
        if (result.warning !== null) {
            notifyUser(`AI change was reverted with a warning: ${result.warning}`, 'warning');
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        notifyUser(`AI change could not be reverted: ${reason}`, 'error');
    }
}
