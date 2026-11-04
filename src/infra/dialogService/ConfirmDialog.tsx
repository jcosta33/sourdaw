import { type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';
import { cn } from '#/utils/Styles/cn';

import { DIALOG_SERVICE_LAYER } from './dialogServiceLayer';
import { useConfirmationDialog } from './useConfirmationDialog';

/**
 * Async confirmation dialog. Subscribes to the `ui.confirm` event bus
 * channel; `confirmUser(...)` from `#/utils/Notification/confirmUser`
 * is the producer side. Replaces `window.confirm` (§183.1 / §196.1)
 * which blocks the JS event loop and causes audible dropouts.
 *
 * Mounted once at the top of AppShell, next to NotificationToast.
 */
export const ConfirmDialog = (): ReactElement => {
    const { pending, confirm, cancel } = useConfirmationDialog();
    const isDanger = pending?.variant === 'danger';

    return (
        <Dialog
            open={Boolean(pending)}
            onOpenChange={(open) => {
                if (!open) {
                    cancel();
                }
            }}
        >
            {pending ? (
                <DialogContent
                    showCloseButton={false}
                    role="dialog"
                    aria-modal="true"
                    aria-label={pending.title ?? pending.message}
                    onKeyDown={(event) => {
                        // This dialog portals to <body> with a focused
                        // button, so an unstopped Delete/Backspace reaches
                        // the window-level shortcut layer and deletes the
                        // selected clips with no confirmation (#3602).
                        // Enter/Escape must keep bubbling: Radix dismiss and
                        // the Enter-confirm path listen above this content.
                        if (event.key === 'Delete' || event.key === 'Backspace') {
                            event.stopPropagation();
                        }
                        if (event.key === 'Enter') {
                            if (event.target instanceof HTMLElement && event.target.tagName === 'BUTTON') {
                                return;
                            }
                            // A destructive choice is never the keyboard default
                            // (macOS HIG, every DAW's save-on-close prompt), so
                            // Enter answers a danger question with Cancel, the
                            // button that holds initial focus.
                            if (isDanger) {
                                cancel();
                                return;
                            }
                            confirm();
                        }
                    }}
                    overlayClassName={DIALOG_SERVICE_LAYER}
                    className={cn(
                        'gap-0 min-w-[320px] max-w-[480px] sm:max-w-[480px] rounded-lg border bg-surface-raised p-4 shadow-xl',
                        DIALOG_SERVICE_LAYER,
                        isDanger ? 'border-[var(--color-state-danger)]/40' : 'border-border'
                    )}
                >
                    {pending.title ? (
                        <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
                            {pending.title}
                        </DialogTitle>
                    ) : null}
                    <DialogDescription className="text-xs text-foreground/90 leading-relaxed">
                        {pending.message}
                    </DialogDescription>
                    <Row align="stretch" justify="end" gap={2} className="mt-4">
                        <Button variant="ghost" size="sm" onClick={cancel} autoFocus>
                            {pending.cancelLabel ?? 'Cancel'}
                        </Button>
                        <Button variant={isDanger ? 'destructive' : 'default'} size="sm" onClick={confirm}>
                            {pending.confirmLabel ?? 'OK'}
                        </Button>
                    </Row>
                </DialogContent>
            ) : null}
        </Dialog>
    );
};
