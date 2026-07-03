import { aiChangeNotificationListeners, type AiChangeNotificationListener } from './aiChangeNotificationState';

export function subscribeAiChangeNotification(callback: AiChangeNotificationListener): () => void {
    aiChangeNotificationListeners.add(callback);
    return () => {
        aiChangeNotificationListeners.delete(callback);
    };
}
