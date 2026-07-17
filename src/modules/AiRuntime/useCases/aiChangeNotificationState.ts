export type AiChangeNotification = {
    id: string;
    summary: string;
    details: string[];
    timestamp: number;
};

export type AiChangeNotificationListener = (change: AiChangeNotification) => void;

// Shared by notifyAiChange() and subscribeAiChangeNotification(); not exported from
// the AiRuntime use-case contract barrel.
export const aiChangeNotificationListeners = new Set<AiChangeNotificationListener>();
