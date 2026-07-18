import { useEffect, useState } from 'react';

import { onNotification } from './onNotification';

type AppNotification = {
    id: string;
    message: string;
    level: 'warning' | 'error' | 'info' | 'success';
    timestamp: number;
};

export function useNotificationQueue(): {
    items: AppNotification[];
    dismissCurrent: () => void;
} {
    const [items, setItems] = useState<AppNotification[]>([]);

    useEffect(() => {
        return onNotification(({ message, level }) => {
            const notification: AppNotification = {
                id: `notif-${crypto.randomUUID()}`,
                message,
                level,
                timestamp: Date.now(),
            };
            setItems((prev) => {
                if (prev.some((existing) => existing.message === notification.message)) {
                    return prev;
                }
                return [...prev, notification];
            });
        });
    }, []);

    // Auto-dismiss the head of the queue after 8s. The effect keys on the head
    // item's id (not the whole `items` array), so a new notification appended to
    // the tail does NOT restart the head's timer — otherwise, under a burst of
    // distinct notifications arriving < 8s apart, the head would never dismiss
    // until the stream paused (the timer was perpetually reset).
    const headId = items[0]?.id;
    useEffect(() => {
        if (headId === undefined) {
            return undefined;
        }
        const timer = setTimeout(() => {
            setItems((prev) => prev.slice(1));
        }, 8000);
        return () => clearTimeout(timer);
    }, [headId]);

    return {
        items,
        // The toast renders the head (`items[0]`) — the oldest unacknowledged
        // notification — and this dismisses that same head, so the dismiss button
        // always clears the notification the user is looking at.
        dismissCurrent: () => {
            setItems((prev) => prev.slice(1));
        },
    };
}
