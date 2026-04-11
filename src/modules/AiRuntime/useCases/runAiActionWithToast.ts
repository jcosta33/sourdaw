import { notifyUser } from '#/helpers/Notification/notifyUser';
import { notifyAiChange } from './notifyAiChange';

export type AiActionToastMessages = {
    startMsg: string;
    successMsg: string;
    successDetails: string[];
    failMsg: string;
};

export async function runAiActionWithToast(action: () => Promise<void>, messages: AiActionToastMessages): Promise<void> {
    notifyUser(messages.startMsg);
    try {
        await action();
        notifyAiChange(messages.successMsg, messages.successDetails);
    } catch {
        notifyUser(messages.failMsg, 'error');
    }
}
