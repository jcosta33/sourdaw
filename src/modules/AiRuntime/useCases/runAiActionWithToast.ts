import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { notifyAiChange } from './notifyAiChange';

export type AiActionToastMessages = {
    startMsg: string;
    successMsg: string;
    successDetails: string[];
    failMsg: string;
};

export async function runAiActionWithToast(
    action: () => Promise<void>,
    messages: AiActionToastMessages
): Promise<void> {
    notifyUser(messages.startMsg);
    try {
        await action();
        notifyAiChange(messages.successMsg, messages.successDetails);
    } catch (error) {
        // The previous bare `catch {}` neither bound nor logged the cause, so a
        // failed action was swallowed: no diagnostic for developers and a toast
        // with no reason for the user. Log the cause and surface it in the toast.
        const cause = error instanceof Error ? error : new Error(String(error));
        logger.error(cause);
        notifyUser(`${messages.failMsg}: ${cause.message}`, 'error');
    }
}
