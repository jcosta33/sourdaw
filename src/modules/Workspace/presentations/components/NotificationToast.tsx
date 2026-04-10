import { type ReactElement } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { cn } from '#/helpers/Styles/cn';
import { useNotificationQueue } from '../hooks/useNotificationQueue';
export { notifyUser } from '#/helpers/Notification/notifyUser';

export const NotificationToast = (): ReactElement | null => {
    const { items, dismissLatest } = useNotificationQueue();

    if (items.length === 0) {
        return null;
    }

    const latest = items[0]!;

    return (
        <div
            className={cn(
                'fixed bottom-16 left-4 z-50 w-80 rounded-lg border p-3 shadow-xl animate-in slide-in-from-left-5',
                latest.level === 'error'
                    ? 'border-[var(--color-state-danger)]/40 bg-[var(--color-state-danger)]/10'
                    : latest.level === 'warning'
                      ? 'border-[var(--color-state-warning)]/40 bg-[var(--color-state-warning)]/10'
                      : 'border-border bg-surface-raised'
            )}
            role="alert"
            aria-live="assertive"
        >
            <div className="flex items-start gap-2">
                <AlertTriangle
                    className={cn(
                        'mt-0.5 size-4 shrink-0',
                        latest.level === 'error'
                            ? 'text-[var(--color-state-danger)]'
                            : 'text-[var(--color-state-warning)]'
                    )}
                />
                <p className="flex-1 text-xs text-foreground">{latest.message}</p>
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={dismissLatest}
                    aria-label="Dismiss notification"
                >
                    <X className="size-3" />
                </Button>
            </div>
            {items.length > 1 ? (
                <p className="mt-1 text-[10px] text-muted-foreground">+{items.length - 1} more</p>
            ) : null}
        </div>
    );
};
