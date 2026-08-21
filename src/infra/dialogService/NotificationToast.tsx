import { type ReactElement } from 'react';

import { AlertTriangle, X } from 'lucide-react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

import { useNotificationQueue } from './useNotificationQueue';

export { notifyUser } from '#/utils/Notification/notifyUser';

export const NotificationToast = (): ReactElement | null => {
    const { items, dismissCurrent } = useNotificationQueue();

    if (items.length === 0) {
        return null;
    }

    // The head of the FIFO queue is the notification currently shown; the rest
    // are summarised as "+N more". Auto-dismiss and the dismiss button both clear
    // this same head item.
    const current = items[0]!;
    let levelSurface = 'border-border bg-surface-raised';
    if (current.level === 'error') {
        levelSurface = 'border-[var(--color-state-danger)]/40 bg-[var(--color-state-danger)]/10';
    } else if (current.level === 'warning') {
        levelSurface = 'border-[var(--color-state-warning)]/40 bg-[var(--color-state-warning)]/10';
    }

    return (
        <div
            className={cn(
                'fixed bottom-16 left-4 z-50 w-80 rounded-lg border p-3 shadow-xl animate-in slide-in-from-left-5',
                levelSurface
            )}
            role="alert"
            aria-live="assertive"
        >
            <Row align="start" gap={2}>
                <AlertTriangle
                    className={cn(
                        'mt-0.5 size-4 shrink-0',
                        current.level === 'error'
                            ? 'text-[var(--color-state-danger)]'
                            : 'text-[var(--color-state-warning)]'
                    )}
                />
                <p className="flex-1 text-xs text-foreground">{current.message}</p>
                <Button variant="ghost" size="xs" onClick={dismissCurrent} aria-label="Dismiss notification">
                    <X className="size-3" />
                </Button>
            </Row>
            {items.length > 1 ? (
                <p className="mt-1 text-[10px] text-muted-foreground">+{items.length - 1} more</p>
            ) : null}
        </div>
    );
};
