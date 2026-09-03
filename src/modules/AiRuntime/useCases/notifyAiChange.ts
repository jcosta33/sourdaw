/**
 * AI change notification bus.
 *
 * Use cases call `notifyAiChange` after applying AI-generated mutations.
 * The `AiChangeToast` view subscribes to render ephemeral feedback.
 */

import {
    HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY,
    type AiChangeNotification,
    aiChangeNotificationListeners,
} from './aiChangeNotificationState';

export type { AiChangeNotification };

/**
 * Monotonic counter combined with the timestamp so two notifications emitted
 * within the same millisecond receive distinct ids (a React list keyed on id
 * would otherwise collapse the second during batch command execution).
 */
let notificationSeq = 0;

const resolveAiChangeNotificationKind = (summary: string, details: string[]): AiChangeNotification['kind'] => {
    if (details.length === 0) {
        return 'notice';
    }
    if (summary === HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY) {
        return 'notice';
    }
    return 'applied-change';
};

export function notifyAiChange(summary: string, details: string[]): void {
    const notification: AiChangeNotification = {
        id: `ai-change-${Date.now()}-${notificationSeq++}`,
        summary,
        details,
        timestamp: Date.now(),
        kind: resolveAiChangeNotificationKind(summary, details),
    };
    for (const listener of aiChangeNotificationListeners) {
        listener(notification);
    }
}
