import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';

/**
 * The id of the command batch a confirmation records. Confirming it claims its work, groups its
 * undo entries and receipts it under this id, whatever group id the confirmation carries.
 */
export function readConfirmationBatchId(confirmation: PendingAppActionConfirmation): string | null {
    const commandBatch = confirmation.approvalSnapshot.commandBatch;
    if (commandBatch === undefined) {
        return null;
    }
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    return parsed.status === 'valid' ? parsed.envelope.batchId : null;
}
