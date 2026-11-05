import { logger } from '#/infra/logger/appLogger';
import { executeAppAction } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { restoreSendEngineFromProjectTruth } from './restoreSendEngineFromProjectTruth';

type SendEditAction = Extract<AppAction, { type: 'setSend' | 'addSend' }>;

/**
 * Dispatches the action one send gesture commits. The gesture previewed on the
 * engine before committing, so a commit that is refused or fails puts the
 * engine back to the send the project holds.
 */
export async function commitSendEdit(action: SendEditAction): Promise<void> {
    try {
        await executeAppAction(action);
    } catch (error) {
        logger.error(new Error(`Send commit failed for action: ${action.type}`, { cause: error }));
        restoreSendEngineFromProjectTruth(action.payload.trackId, action.payload.busId);
    }
}
