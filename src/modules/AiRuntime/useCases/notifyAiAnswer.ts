import {
    type AiAnswerNotice,
    type AiChangeNotification,
    aiChangeNotificationListeners,
} from './aiChangeNotificationState';

let answerSeq = 0;

/**
 * Shows a planning answer as a Prompt Bar notice. Unlike a change notice it stays until the user
 * dismisses it, and it keeps the whole answer so the chat can show it in full.
 */
export function notifyAiAnswer(answer: AiAnswerNotice): void {
    const notification: AiChangeNotification = {
        id: `ai-answer-${Date.now()}-${answerSeq++}`,
        summary: answer.text,
        details: [],
        timestamp: Date.now(),
        kind: 'answer',
        answer,
    };
    for (const listener of aiChangeNotificationListeners) {
        listener(notification);
    }
}
