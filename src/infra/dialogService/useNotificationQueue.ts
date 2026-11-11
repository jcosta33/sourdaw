import { useEffect, useState } from 'react';

import type { NotificationAction } from '#/utils/Notification/notificationEventBus';

import { onNotification } from './onNotification';

const HISTORY_LIMIT = 50;

type NotificationActionStatus = 'idle' | 'running' | 'success' | 'stale' | 'refused' | 'failed';

export type AppNotification = {
    id: string;
    message: string;
    level: 'warning' | 'error' | 'info' | 'success';
    timestamp: number;
    read: boolean;
    action?: NotificationAction;
    actionStatus: NotificationActionStatus;
    actionFeedback?: string;
};

type NotificationState = {
    items: AppNotification[];
    history: AppNotification[];
};

function updateHistoryEntry(
    state: NotificationState,
    id: string,
    update: (entry: AppNotification) => AppNotification
): NotificationState {
    return {
        ...state,
        history: state.history.map((entry) => (entry.id === id ? update(entry) : entry)),
    };
}

export function useNotificationQueue(): {
    items: AppNotification[];
    history: AppNotification[];
    unreadCount: number;
    dismissCurrent: () => void;
    dismissNotification: (id: string) => void;
    markAllRead: () => void;
    runAction: (id: string) => Promise<void>;
} {
    // Queue and history share one atomic state so a deduplicated toast cannot
    // accidentally append a duplicate history entry. Neither is persisted.
    const [state, setState] = useState<NotificationState>({ items: [], history: [] });

    useEffect(() => {
        return onNotification(({ message, level, action }) => {
            const notification: AppNotification = {
                id: `notif-${crypto.randomUUID()}`,
                message,
                level,
                timestamp: Date.now(),
                read: false,
                action,
                actionStatus: 'idle',
            };
            setState((previous) => {
                if (previous.items.some((existing) => existing.message === notification.message)) {
                    return previous;
                }
                return {
                    items: [...previous.items, notification],
                    history: [notification, ...previous.history].slice(0, HISTORY_LIMIT),
                };
            });
        });
    }, []);

    // Auto-dismiss the head after 8s without restarting when a tail item arrives.
    // Expiry removes only the lightweight toast; the unread history remains.
    const headId = state.items[0]?.id;
    useEffect(() => {
        if (headId === undefined) {
            return undefined;
        }
        const timer = setTimeout(() => {
            setState((previous) => ({ ...previous, items: previous.items.slice(1) }));
        }, 8000);
        return () => clearTimeout(timer);
    }, [headId]);

    const runAction = async (id: string): Promise<void> => {
        const notification = state.history.find((candidate) => candidate.id === id);
        const action = notification?.action;
        if (!notification || !action || notification.actionStatus === 'running') {
            return;
        }

        setState((previous) =>
            updateHistoryEntry(previous, id, (current) => ({
                ...current,
                actionStatus: 'running',
                actionFeedback: undefined,
            }))
        );

        let valid: boolean;
        try {
            valid = action.isValid();
        } catch {
            valid = false;
        }
        if (!valid) {
            setState((previous) =>
                updateHistoryEntry(previous, id, (current) => ({
                    ...current,
                    actionStatus: 'stale',
                    actionFeedback: action.staleMessage ?? 'This action is no longer available.',
                }))
            );
            return;
        }

        try {
            const result = await action.execute();
            if (result === false) {
                setState((previous) =>
                    updateHistoryEntry(previous, id, (current) => ({
                        ...current,
                        actionStatus: 'refused',
                        actionFeedback: action.refusedMessage ?? 'The action was refused.',
                    }))
                );
                return;
            }
            setState((previous) =>
                updateHistoryEntry(previous, id, (current) => ({
                    ...current,
                    actionStatus: 'success',
                    actionFeedback: action.successMessage ?? `${action.label} completed.`,
                }))
            );
        } catch {
            setState((previous) =>
                updateHistoryEntry(previous, id, (current) => ({
                    ...current,
                    actionStatus: 'failed',
                    actionFeedback: action.failureMessage ?? 'The action failed. Try again.',
                }))
            );
        }
    };

    return {
        items: state.items,
        history: state.history,
        unreadCount: state.history.filter((notification) => !notification.read).length,
        dismissCurrent: () => {
            setState((previous) => {
                const current = previous.items[0];
                if (!current) {
                    return previous;
                }
                return {
                    items: previous.items.slice(1),
                    history: previous.history.map((notification) =>
                        notification.id === current.id ? { ...notification, read: true } : notification
                    ),
                };
            });
        },
        dismissNotification: (id) => {
            setState((previous) => ({
                items: previous.items.filter((notification) => notification.id !== id),
                history: previous.history.filter((notification) => notification.id !== id),
            }));
        },
        markAllRead: () => {
            setState((previous) => ({
                ...previous,
                history: previous.history.map((notification) => ({ ...notification, read: true })),
            }));
        },
        runAction,
    };
}
