import { type ReactElement, useEffect, useRef } from 'react';

import { Button } from '#/components/ui/button';
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
export const PromptDialog = (): ReactElement | null => {
    const { pending, value, setValue, submit, cancel } = usePromptDialog();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (pending) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [pending]);

    if (!pending) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby={pending.title ? 'prompt-dialog-title' : undefined}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    cancel();
                } else if (event.key === 'Enter') {
                    submit();
                }
            }}
        >
            <div className="min-w-[320px] max-w-[480px] rounded-lg border border-border bg-surface-raised p-4 shadow-xl animate-in zoom-in-95 duration-150">
                {pending.title ? (
                    <h2 id="prompt-dialog-title" className="mb-2 text-sm font-semibold text-foreground">
                        {pending.title}
                    </h2>
                ) : null}
                <p className="text-xs text-foreground/90 leading-relaxed">{pending.message}</p>
                <Input
                    ref={inputRef}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={pending.placeholder}
                    aria-label={pending.title ?? pending.message}
                    className="mt-3"
                    autoFocus
                />
                <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={cancel}>
                        {pending.cancelLabel ?? 'Cancel'}
                    </Button>
                    <Button variant="default" size="sm" onClick={submit}>
                        {pending.confirmLabel ?? 'OK'}
                    </Button>
                </div>
            </div>
        </div>
    );
};
