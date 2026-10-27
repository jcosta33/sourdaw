import { updateChatMessage } from '../../stores/chatStore';
import {
    type PendingAppActionConfirmation,
    supersedePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';

import { pendingActionResourceSettlement } from './pendingActionResourceSettlement';

type SupersessionNotice = {
    /** The confirmation's recorded error, which the approval view shows as why it went stale. */
    reason: string;
    /** What its chat message says in place of the proposal it held. */
    content: string;
};

/**
 * Retire a proposal a newer one replaced: invalidate it under the replacement's id, discard its
 * prepared resources, and say why in its chat message. An invalidated card offers no Confirm, and
 * confirming it anyway is refused as no longer pending, so the replaced batch can never run.
 */
export async function retireSupersededConfirmation(
    confirmation: PendingAppActionConfirmation,
    supersededBy: string,
    notice: SupersessionNotice
): Promise<void> {
    supersedePendingActionConfirmation({
        confirmationId: confirmation.id,
        supersededBy,
        reason: notice.reason,
    });
    await pendingActionResourceSettlement.settleBestEffort({
        confirmationId: confirmation.id,
        disposition: 'discard',
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'invalidated',
        error: notice.reason,
        content: notice.content,
    });
}
