import { type ReactElement } from 'react';

/**
 * Minimal application shell painted before the full App chunk resolves. Iframe
 * remounts after display-scale reload must expose `app-shell` within seconds;
 * the App import graph must not occupy that window.
 */
export function ApplicationFirstPaint(): ReactElement {
    return <div className="h-screen w-screen overflow-hidden bg-surface-app" data-testid="app-shell" />;
}
