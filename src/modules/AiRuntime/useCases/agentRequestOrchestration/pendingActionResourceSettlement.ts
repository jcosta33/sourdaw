import { logger } from '#/infra/logger/appLogger';

import {
    commitPendingActionResourceLease,
    settlePendingActionResourceLeaseBestEffort,
} from '../../stores/pendingActionConfirmationStore';

type ResourceDisposition = 'discard' | 'retain' | 'transfer';

async function settleBestEffort(input: { confirmationId: string; disposition: ResourceDisposition }): Promise<void> {
    await settlePendingActionResourceLeaseBestEffort(input);
}

async function retainCommitted(confirmationId: string): Promise<void> {
    try {
        await commitPendingActionResourceLease(confirmationId);
    } catch (error) {
        logger.error(new Error('Committed resource recovery could not be made executable', { cause: error }));
        return;
    }
    await settleBestEffort({ confirmationId, disposition: 'transfer' });
}

export const pendingActionResourceSettlement = {
    retainCommitted,
    settleBestEffort,
};
