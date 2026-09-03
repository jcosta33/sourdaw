export const HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY = 'Hosted AI privacy disclosure';

export type AiChangeNotification = {
    id: string;
    summary: string;
    details: string[];
    timestamp: number;
    kind: 'applied-change' | 'notice';
};

export type AiChangeNotificationListener = (change: AiChangeNotification) => void;

// Shared by notifyAiChange() and subscribeAiChangeNotification(); not exported from
// the AiRuntime use-case contract barrel.
export const aiChangeNotificationListeners = new Set<AiChangeNotificationListener>();
