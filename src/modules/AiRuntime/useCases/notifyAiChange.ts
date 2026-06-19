/**
 * AI change notification bus.
 *
 * Use cases call `notifyAiChange` after applying AI-generated mutations.
 * The `AiChangeToast` view subscribes to render ephemeral feedback.
 */

export type AiChangeNotification = {
    id: string;
    summary: string;
    details: string[];
    timestamp: number;
};

let changeListeners: ((change: AiChangeNotification) => void)[] = [];

/**
 * Monotonic counter combined with the timestamp so two notifications emitted
 * within the same millisecond receive distinct ids (a React list keyed on id
 * would otherwise collapse the second — observable during batch DSO execution).
 */
let notificationSeq = 0;

export function subscribeAiChangeNotification(cb: (change: AiChangeNotification) => void): () => void {
    changeListeners.push(cb);
    return () => {
        changeListeners = changeListeners.filter((length) => length !== cb);
    };
}

export function notifyAiChange(summary: string, details: string[]): void {
    const notification: AiChangeNotification = {
        id: `ai-change-${Date.now()}-${notificationSeq++}`,
        summary,
        details,
        timestamp: Date.now(),
    };
    for (const listener of changeListeners) {
        listener(notification);
    }
}
