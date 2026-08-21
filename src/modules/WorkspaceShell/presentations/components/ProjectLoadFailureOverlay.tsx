import { type KeyboardEvent as ReactKeyboardEvent, type ReactElement, useEffect, useRef } from 'react';

import { Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { SourdawLogo } from './SourdawLogo';

type ProjectLoadFailureOverlayProps = {
    message: string;
    projectName: string;
    onReload: () => void;
};

/**
 * Shown when a project open destroyed the previous session and could not put a
 * project in its place.
 *
 * Blocking and non-dismissing on purpose. The alternative — flags plus a toast —
 * puts the user in the full editor over an empty `Untitled Project` with an
 * 8-second notification, after which nothing on screen says anything went wrong
 * and every edit they make lands in a document that is not theirs. Reloading is
 * the real recovery: nothing was compacted, so the project is still in
 * IndexedDB and the boot restore reopens it.
 */
export const ProjectLoadFailureOverlay = ({
    message,
    projectName,
    onReload,
}: ProjectLoadFailureOverlayProps): ReactElement => {
    const reloadRef = useRef<HTMLButtonElement>(null);

    // `aria-modal="true"` tells assistive tech to ignore everything outside this
    // node. Without moving focus in, a screen-reader user is left parked in the
    // content that instruction just suppressed, with no route to the only
    // action on screen. `ConfirmDialog` sets the same precedent with `autoFocus`.
    useEffect(() => {
        reloadRef.current?.focus();
    }, []);

    // There is exactly one focusable element here, so the trap is Tab and
    // Shift+Tab both landing back on it. Escape is deliberately not wired: the
    // surface has nothing to return to.
    const keepFocusInside = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'Tab') {
            return;
        }
        event.preventDefault();
        reloadRef.current?.focus();
    };

    return (
        <Stack
            align="center"
            justify="center"
            className="fixed inset-0 z-[10000] px-6 text-center"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="project-load-failure-title"
            aria-describedby="project-load-failure-message"
            onKeyDown={keepFocusInside}
            style={{ background: 'hsl(220,14%,8%)' }}
        >
            <SourdawLogo className="mb-6 h-20 opacity-80" />

            <h1 id="project-load-failure-title" className="mb-3 text-xl font-bold tracking-tight text-white/90">
                Could not open “{projectName}”
            </h1>

            <p id="project-load-failure-message" className="mb-2 max-w-md text-sm text-white/60">
                {message}
            </p>

            <p className="mb-6 max-w-md text-sm text-white/60">
                Your saved projects were not modified. Reload to get back to them.
            </p>

            <Button
                variant="bare"
                size="bare"
                ref={reloadRef}
                type="button"
                onClick={onReload}
                className="rounded-md px-4 py-2 text-sm font-medium text-white/90 ring-1 ring-white/20 hover:ring-white/40"
            >
                Reload
            </Button>
        </Stack>
    );
};
