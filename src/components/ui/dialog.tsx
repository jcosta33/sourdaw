import { type ComponentProps, createContext, useContext, useState } from 'react';

import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

export function Dialog({ ...props }: ComponentProps<typeof DialogPrimitive.Root>) {
    const [wasOpen, setWasOpen] = useState(false);
    const [opener, setOpener] = useState<FocusOpener | null>(null);
    const isOpen = props.open === true;
    if (isOpen !== wasOpen) {
        setWasOpen(isOpen);
        if (isOpen) {
            setOpener(readFocusOpener());
        }
    }

    return (
        <FocusOpenerContext value={opener}>
            <DialogPrimitive.Root data-slot="dialog" {...props} />
        </FocusOpenerContext>
    );
}

export function DialogTrigger({ ...props }: ComponentProps<typeof DialogPrimitive.Trigger>) {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogPortal({ ...props }: ComponentProps<typeof DialogPrimitive.Portal>) {
    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

export function DialogClose({ ...props }: ComponentProps<typeof DialogPrimitive.Close>) {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
    return (
        <DialogPrimitive.Overlay
            data-slot="dialog-overlay"
            className={cn(
                'fixed inset-0 z-50 bg-bg-scrim backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
                className
            )}
            {...props}
        />
    );
}

/** Marks the element focus falls back to when a dialog's opener no longer exists. */
const FOCUS_LANDMARK_SELECTOR = '[data-focus-landmark]';

type FocusOpener = {
    element: HTMLElement | null;
    /** Trigger of the menu or popover the opener lives in; that surface closes when its control opens a dialog. */
    surfaceTrigger: (() => HTMLElement | null) | null;
};

/** `null` while the dialog was never opened through its `open` prop; Radix then keeps its own trigger handling. */
const FocusOpenerContext = createContext<FocusOpener | null>(null);

/** A menu names its trigger through `aria-labelledby`; a popover's trigger names the popover through `aria-controls`. */
const readSurfaceTrigger = (element: HTMLElement): (() => HTMLElement | null) | null => {
    const menuTriggerId = element.closest('[role="menu"]')?.getAttribute('aria-labelledby');
    if (menuTriggerId) {
        return () => document.getElementById(menuTriggerId);
    }
    const popoverId = element.closest('[role="dialog"]')?.id;
    if (!popoverId) {
        return null;
    }
    const popoverTrigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(popoverId)}"]`);
    return () => popoverTrigger;
};

const readFocusOpener = (): FocusOpener => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
        return { element: null, surfaceTrigger: null };
    }
    return { element: active, surfaceTrigger: readSurfaceTrigger(active) };
};

const findFocusLandmark = (): HTMLElement | null => document.querySelector<HTMLElement>(FOCUS_LANDMARK_SELECTOR);

/** Moves focus to the workspace landmark unless it already rests on a live element. */
export const focusLandmarkIfUnfocused = (): void => {
    const active = document.activeElement;
    if (active === null || active === document.body) {
        findFocusLandmark()?.focus();
    }
};

const focusReturnCandidates = ({ element, surfaceTrigger }: FocusOpener): (HTMLElement | null)[] => [
    element,
    surfaceTrigger?.() ?? null,
    findFocusLandmark(),
];

/** A disabled or hidden candidate stays connected but refuses focus, so success is read back from the document. */
const focusFirstAccepting = (candidates: (HTMLElement | null)[]): boolean => {
    for (const candidate of candidates) {
        candidate?.focus();
        if (candidate !== null && document.activeElement === candidate) {
            return true;
        }
    }
    return false;
};

/**
 * Radix's modal dialog answers `onCloseAutoFocus` by cancelling FocusScope's own restore and focusing
 * `Dialog.Trigger` only. A dialog opened from a store flag, a shortcut or a menu item has no trigger, so
 * focus fell to <body>. Return to the element that was focused when `open` turned true (read while
 * rendering, because an `autoFocus` field inside the dialog takes focus during commit), else to the
 * trigger of the menu or popover it lived in, else to the workspace landmark: the first that accepts focus wins, and if
 * none does Radix's own restore is left alone.
 */
function useFocusReturn({
    onCloseAutoFocus,
}: Pick<ComponentProps<typeof DialogPrimitive.Content>, 'onCloseAutoFocus'>) {
    const opener = useContext(FocusOpenerContext);

    return {
        onCloseAutoFocus: (event: Event) => {
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented || opener === null) {
                return;
            }
            if (focusFirstAccepting(focusReturnCandidates(opener))) {
                event.preventDefault();
            }
        },
    };
}

export function DialogContent({
    className,
    children,
    overlayClassName,
    showCloseButton = true,
    onCloseAutoFocus,
    ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
    /** Classes for the scrim, which has to share a raised layer with its content. */
    overlayClassName?: string;
    showCloseButton?: boolean;
}) {
    const focusReturn = useFocusReturn({ onCloseAutoFocus });

    return (
        <DialogPortal data-slot="dialog-portal">
            <DialogOverlay className={overlayClassName} />
            <DialogPrimitive.Content
                data-slot="dialog-content"
                {...focusReturn}
                className={cn(
                    'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-md border border-black/40 border-t-[var(--color-light-edge)] bg-surface-dialog p-6 shadow-elevation-modal duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
                    className
                )}
                {...props}
            >
                {children}
                {showCloseButton ? (
                    <DialogPrimitive.Close
                        data-slot="dialog-close"
                        className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                    >
                        <XIcon />
                        <span className="sr-only">Close</span>
                    </DialogPrimitive.Close>
                ) : null}
            </DialogPrimitive.Content>
        </DialogPortal>
    );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
    return (
        <div
            data-slot="dialog-header"
            className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
            {...props}
        />
    );
}

export function DialogFooter({
    className,
    showCloseButton = false,
    children,
    ...props
}: ComponentProps<'div'> & {
    showCloseButton?: boolean;
}) {
    return (
        <div
            data-slot="dialog-footer"
            className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
            {...props}
        >
            {children}
            {showCloseButton ? (
                <DialogPrimitive.Close asChild>
                    <Button variant="outline">Close</Button>
                </DialogPrimitive.Close>
            ) : null}
        </div>
    );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
    return (
        <DialogPrimitive.Title
            data-slot="dialog-title"
            className={cn('text-lg leading-none font-semibold', className)}
            {...props}
        />
    );
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
    return (
        <DialogPrimitive.Description
            data-slot="dialog-description"
            className={cn('text-sm text-muted-foreground', className)}
            {...props}
        />
    );
}
