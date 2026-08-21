import { type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

import { useConfirmationDialog } from './useConfirmationDialog';

/**
 * Async confirmation dialog. Subscribes to the \`ui.confirm\` event bus
 * channel; \`confirmUser(...)\` from \`#/utils/Notification/confirmUser\`
 * is the producer side. Replaces \`window.confirm\` (§183.1 / §196.1)
 * which blocks the JS event loop and causes audible dropouts.
 *
 * Mounted once at the top of AppShell, next to NotificationToast.
 */
export const ConfirmDialog = (): ReactElement | null => {
    const { pending, confirm, cancel } = useConfirmationDialog();

    if (!pending) {
        return null;
    }

    const isDanger = pending.variant === 'danger';

    return (
        <Row
            justify="center"
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    cancel();
                } else if (event.key === 'Enter') {
                    confirm();
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
                <Row align="stretch" justify="end" gap={2} className="mt-4">
                    <Button variant="ghost" size="sm" onClick={cancel} autoFocus={!isDanger}>
                        {pending.cancelLabel ?? 'Cancel'}
                    </Button>
                    <Button
                        variant={isDanger ? 'destructive' : 'default'}
                        size="sm"
                        onClick={confirm}
                        autoFocus={isDanger}
                    >
                        {pending.confirmLabel ?? 'OK'}
                    </Button>
                </Row>
            </div>
        </Row>
    );
};
