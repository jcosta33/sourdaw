/**
 * AI change notification bus.
 *
 * Use cases call `notifyAiChange` after applying AI-generated mutations.
 * The `AiChangeToast` view subscribes to render ephemeral feedback.
 */

import { type AiChangeNotification, aiChangeNotificationListeners } from './aiChangeNotificationState';

export type { AiChangeNotification };

/**
 * Monotonic counter combined with the timestamp so two notifications emitted
 * within the same millisecond receive distinct ids (a React list keyed on id
 * would otherwise collapse the second during batch command execution).
 */
let notificationSeq = 0;

export function notifyAiChange(summary: string, details: string[]): void {
    const notification: AiChangeNotification = {
        id: `ai-change-${Date.now()}-${notificationSeq++}`,
        summary,
        details,
        timestamp: Date.now(),
    };
    for (const listener of aiChangeNotificationListeners) {
        listener(notification);
    }
}
