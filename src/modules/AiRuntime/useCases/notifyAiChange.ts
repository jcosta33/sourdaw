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

export function subscribeAiChangeNotification(cb: (change: AiChangeNotification) => void): () => void {
    changeListeners.push(cb);
    return () => {
        changeListeners = changeListeners.filter((l) => l !== cb);
    };
}

export function notifyAiChange(summary: string, details: string[]): void {
    const notification: AiChangeNotification = {
        id: `ai-change-${Date.now()}`,
        summary,
        details,
        timestamp: Date.now(),
    };
    for (const listener of changeListeners) {
        listener(notification);
    }
}
