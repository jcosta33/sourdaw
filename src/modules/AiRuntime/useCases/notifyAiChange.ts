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

// §60.1 — Use a Set inside a holder so the binding can't be reassigned from
// outside this file and the unsubscribe path is O(1) instead of allocating a
// filtered copy. Mirrors the prompt-injection bus in `promptInjection.ts`.
const changeBus: { listeners: Set<(change: AiChangeNotification) => void> } = {
    listeners: new Set(),
};

/**
 * Monotonic counter combined with the timestamp so two notifications emitted
 * within the same millisecond receive distinct ids (a React list keyed on id
 * would otherwise collapse the second — observable during batch DSO execution).
 */
let notificationSeq = 0;

export function subscribeAiChangeNotification(cb: (change: AiChangeNotification) => void): () => void {
    changeBus.listeners.add(cb);
    return () => {
        changeBus.listeners.delete(cb);
    };
}

export function notifyAiChange(summary: string, details: string[]): void {
    const notification: AiChangeNotification = {
        id: `ai-change-${Date.now()}-${notificationSeq++}`,
        summary,
        details,
        timestamp: Date.now(),
    };
    for (const listener of changeBus.listeners) {
        listener(notification);
    }
}
