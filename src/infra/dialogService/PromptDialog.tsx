import { type ReactElement, useEffect, useRef } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';

import { usePromptDialog } from './usePromptDialog';

/**
 * Async single-field text-prompt dialog. Subscribes to the `ui.prompt` event
 * bus channel; `promptUser(...)` from `#/utils/Notification/promptUser` is the
 * producer side. Themed sibling of `ConfirmDialog` — replaces `window.prompt`,
 * which blocks the JS event loop.
 *
 * Mounted once at the top of AppShell, next to ConfirmDialog.
 */
export const PromptDialog = (): ReactElement => {
    const { pending, value, setValue, submit, cancel } = usePromptDialog();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (pending) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [pending]);

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
                        if (event.key === 'Escape') {
                            cancel();
                        } else if (event.key === 'Enter') {
                            if (event.target instanceof HTMLElement && event.target.tagName === 'BUTTON') {
                                return;
                            }
                            submit();
                        }
                    }}
                    className="gap-0 min-w-[320px] max-w-[480px] rounded-lg border border-border bg-surface-raised p-4 shadow-xl"
                >
                    {pending.title ? (
                        <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
                            {pending.title}
                        </DialogTitle>
                    ) : null}
                    <DialogDescription className="text-xs text-foreground/90 leading-relaxed">
                        {pending.message}
                    </DialogDescription>
                    <Input
                        ref={inputRef}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder={pending.placeholder}
                        aria-label={pending.title ?? pending.message}
                        className="mt-3"
                        autoFocus
                    />
                    <Row align="stretch" justify="end" gap={2} className="mt-4">
                        <Button variant="ghost" size="sm" onClick={cancel}>
                            {pending.cancelLabel ?? 'Cancel'}
                        </Button>
                        <Button variant="default" size="sm" onClick={submit}>
                            {pending.confirmLabel ?? 'OK'}
                        </Button>
                    </Row>
                </DialogContent>
            ) : null}
        </Dialog>
    );
};
