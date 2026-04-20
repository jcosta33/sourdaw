import { useEffect, useState } from 'react';

import { onNotification } from '../../useCases/onNotification';

type AppNotification = {
    id: string;
    message: string;
    level: 'warning' | 'error' | 'info' | 'success';
    timestamp: number;
};

export function useNotificationQueue(): {
    items: AppNotification[];
    dismissLatest: () => void;
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

    useEffect(() => {
        if (items.length === 0) {
            return undefined;
        }
        const timer = setTimeout(() => {
            setItems((prev) => prev.slice(1));
        }, 8000);
        return () => clearTimeout(timer);
    }, [items]);

    return {
        items,
        dismissLatest: () => {
            setItems((prev) => prev.slice(1));
        },
    };
}
