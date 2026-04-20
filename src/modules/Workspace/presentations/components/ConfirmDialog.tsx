import { type ReactElement, useEffect, useState } from 'react';

import { eventBus } from '#/app/registerDependencies';
import { Button } from '#/components/ui/button';
import { type ConfirmPayload } from '#/modules/Workspace/events';
import { cn } from '#/utils/Styles/cn';

/**
 * Async confirmation dialog. Subscribes to the \`ui.confirm\` event bus
 * channel; \`confirmUser(...)\` from \`#/utils/Notification/confirmUser\`
 * is the producer side. Replaces \`window.confirm\` (§183.1 / §196.1)
 * which blocks the JS event loop and causes audible dropouts.
 *
 * Mounted once at the top of AppShell, next to NotificationToast.
 */
export const ConfirmDialog = (): ReactElement | null => {
    const [pending, setPending] = useState<ConfirmPayload | null>(null);

    useEffect(() => {
        return eventBus.on('ui.confirm', (payload) => {
            // If a previous confirm is still on screen we resolve it as
            // cancelled — only one dialog is visible at a time.
            setPending((current) => {
                if (current) {
                    current.resolve(false);
                }
                return payload;
            });
        });
    }, []);

    if (!pending) {
        return null;
    }

    const handleConfirm = (): void => {
        pending.resolve(true);
        setPending(null);
    };

    const handleCancel = (): void => {
        pending.resolve(false);
        setPending(null);
    };

    const isDanger = pending.variant === 'danger';

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    handleCancel();
                } else if (e.key === 'Enter') {
                    handleConfirm();
                }
            }}
        >
            <div
                className={cn(
                    'min-w-[320px] max-w-[480px] rounded-lg border bg-surface-raised p-4 shadow-xl animate-in zoom-in-95 duration-150',
                    isDanger ? 'border-[var(--color-state-danger)]/40' : 'border-border'
                )}
            >
                {pending.title ? (
                    <h2 id="confirm-dialog-title" className="mb-2 text-sm font-semibold text-foreground">
                        {pending.title}
                    </h2>
                ) : null}
                <p className="text-xs text-foreground/90 leading-relaxed">{pending.message}</p>
                <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={handleCancel} autoFocus={!isDanger}>
                        {pending.cancelLabel ?? 'Cancel'}
                    </Button>
                    <Button
                        variant={isDanger ? 'destructive' : 'default'}
                        size="sm"
                        onClick={handleConfirm}
                        autoFocus={isDanger}
                    >
                        {pending.confirmLabel ?? 'OK'}
                    </Button>
                </div>
            </div>
        </div>
    );
};
