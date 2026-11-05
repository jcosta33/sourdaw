import { useEffect, useRef } from 'react';

type FocusEachRequest = {
    onOpenAutoFocus: (event: Event) => void;
};

/**
 * Focuses a dialog's default control for every request it shows. A request
 * replacing an open one keeps the dialog content mounted, so Radix's open
 * autofocus does not run again and the replacement is focused from the effect
 * instead, where the content's focus trap is already live and records the
 * control. Focusing from the open handler, not a remount, keeps that trap
 * recording the control and avoids the close-time focus return.
 */
export const useFocusEachRequest = <Request extends object>(
    pending: Request | null,
    focus: (request: Request) => void
): FocusEachRequest => {
    const focusedRef = useRef<Request | null>(null);

    const focusRequest = (request: Request): void => {
        focusedRef.current = request;
        focus(request);
    };

    useEffect(() => {
        if (pending === null) {
            focusedRef.current = null;
            return;
        }
        if (focusedRef.current !== null && focusedRef.current !== pending) {
            focusRequest(pending);
        }
    }, [pending]);

    const onOpenAutoFocus = (event: Event): void => {
        event.preventDefault();
        if (pending !== null) {
            focusRequest(pending);
        }
    };

    return { onOpenAutoFocus };
};
