import { notifyUser } from '#/helpers/Notification/notifyUser';
import { notifyAiChange } from './notifyAiChange';

export type AiActionToastMessages = {
    startMsg: string;
    successMsg: string;
    successDetails: string[];
    failMsg: string;
};

/**
 * Run an async AI-triggered action and emit toasts for the start / success / failure phases.
 * Centralises the notify → execute → notify-change / notify-error orchestration that context
 * menus and inspectors would otherwise repeat inline.
 */
export async function runAiActionWithToast(
    action: () => Promise<void>,
    messages: AiActionToastMessages
): Promise<void> {
    notifyUser(messages.startMsg);
    try {
        await action();
        notifyAiChange(messages.successMsg, messages.successDetails);
    } catch {
        notifyUser(messages.failMsg, 'error');
    }
}
