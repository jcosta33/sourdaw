import { type ReactElement, useState } from 'react';

import { AlertTriangle, Bell, X } from 'lucide-react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { cn } from '#/utils/Styles/cn';

import { DIALOG_SERVICE_LAYER } from './dialogServiceLayer';
import { type AppNotification, useNotificationQueue } from './useNotificationQueue';

export { notifyUser } from '#/utils/Notification/notifyUser';

type SeverityFilter = AppNotification['level'] | 'all';

type NotificationHistoryProps = {
    history: AppNotification[];
    unreadCount: number;
    dismissNotification: (id: string) => void;
    markAllRead: () => void;
    runAction: (id: string) => Promise<void>;
};

type NotificationHistoryEntryProps = {
    entry: AppNotification;
    dismissNotification: (id: string) => void;
    runAction: (id: string) => Promise<void>;
};

const NotificationHistoryEntry = ({
    entry,
    dismissNotification,
    runAction,
}: NotificationHistoryEntryProps): ReactElement => (
    <li aria-label={`${entry.level}: ${entry.message}`} className="border-b border-border-soft/50 p-3 last:border-b-0">
        <Row align="start" gap={2}>
            <div className="min-w-0 flex-1">
                <p className="text-xs capitalize text-muted-foreground">
                    {entry.level} · {new Date(entry.timestamp).toLocaleTimeString()}
                </p>
                <p className="mt-1 text-xs text-foreground">{entry.message}</p>
            </div>
            <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Dismiss ${entry.message}`}
                onClick={() => dismissNotification(entry.id)}
            >
                <X />
            </Button>
        </Row>
        {entry.action ? (
            <div className="mt-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={
                        entry.actionStatus === 'running' ||
                        entry.actionStatus === 'success' ||
                        entry.actionStatus === 'stale'
                    }
                    onClick={() => {
                        void runAction(entry.id);
                    }}
                >
                    {entry.actionStatus === 'running' ? `${entry.action.label}…` : entry.action.label}
                </Button>
            </div>
        ) : null}
        {entry.actionFeedback ? (
            <p className="mt-1 text-[11px] text-muted-foreground" role="status">
                {entry.actionFeedback}
            </p>
        ) : null}
    </li>
);

const NotificationHistory = ({
    history,
    unreadCount,
    dismissNotification,
    markAllRead,
    runAction,
}: NotificationHistoryProps): ReactElement | null => {
    const [filter, setFilter] = useState<SeverityFilter>('all');
    if (history.length === 0) {
        return null;
    }
    const visibleEntries = filter === 'all' ? history : history.filter((entry) => entry.level === filter);

    return (
        <div className={cn('fixed bottom-4 right-4', DIALOG_SERVICE_LAYER)}>
            <Popover
                onOpenChange={(open) => {
                    if (open) {
                        markAllRead();
                    }
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        variant="surface"
                        size="sm"
                        aria-label={
                            unreadCount > 0 ? `Notification history, ${unreadCount} unread` : 'Notification history'
                        }
                    >
                        <Bell className="size-3.5" />
                        History
                        {unreadCount > 0 ? (
                            <span
                                aria-hidden="true"
                                className="min-w-4 rounded-full bg-[var(--color-accent-cyan)] px-1 text-center text-[10px] text-surface-default"
                            >
                                {unreadCount}
                            </span>
                        ) : null}
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    side="top"
                    align="end"
                    aria-label="Notification history"
                    className={cn('w-96 p-0', DIALOG_SERVICE_LAYER)}
                >
                    <div className="border-b border-border-soft p-3">
                        <h2 className="text-sm font-medium text-foreground">Notification history</h2>
                        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            Severity
                            <select
                                aria-label="Filter notifications by severity"
                                className="h-6 rounded-sm border border-border-soft bg-surface-inset px-2 text-[11px] text-foreground"
                                value={filter}
                                onChange={(event) => setFilter(event.target.value as SeverityFilter)}
                            >
                                <option value="all">All</option>
                                <option value="info">Info</option>
                                <option value="success">Success</option>
                                <option value="warning">Warning</option>
                                <option value="error">Error</option>
                            </select>
                        </label>
                    </div>
                    {visibleEntries.length > 0 ? (
                        <ul aria-label="Notifications" className="max-h-80 overflow-y-auto">
                            {visibleEntries.map((entry) => (
                                <NotificationHistoryEntry
                                    key={entry.id}
                                    entry={entry}
                                    dismissNotification={dismissNotification}
                                    runAction={runAction}
                                />
                            ))}
                        </ul>
                    ) : (
                        <p className="p-4 text-center text-xs text-muted-foreground">
                            No {filter} notifications in this session.
                        </p>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
};

export const NotificationToast = (): ReactElement | null => {
    const { items, history, unreadCount, dismissCurrent, dismissNotification, markAllRead, runAction } =
        useNotificationQueue();
    const current = items[0];
    let levelSurface = 'border-border bg-surface-raised';
    if (current?.level === 'error') {
        levelSurface = 'border-[var(--color-state-danger)]/40 bg-[var(--color-state-danger)]/10';
    } else if (current?.level === 'warning') {
        levelSurface = 'border-[var(--color-state-warning)]/40 bg-[var(--color-state-warning)]/10';
    }

    return (
        <>
            <NotificationHistory
                history={history}
                unreadCount={unreadCount}
                dismissNotification={dismissNotification}
                markAllRead={markAllRead}
                runAction={runAction}
            />
            {current ? (
                <div
                    className={cn(
                        'pointer-events-none fixed top-14 right-4 w-80 rounded-lg border p-3 shadow-xl animate-in slide-in-from-top-2',
                        DIALOG_SERVICE_LAYER,
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
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={dismissCurrent}
                            aria-label="Dismiss notification"
                            className="pointer-events-auto"
                        >
                            <X className="size-3" />
                        </Button>
                    </Row>
                    {items.length > 1 ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">+{items.length - 1} more</p>
                    ) : null}
                </div>
            ) : null}
        </>
    );
};
