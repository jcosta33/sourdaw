import { type ReactElement } from 'react';

import { DesktopStartupError } from './DesktopStartupError';

/**
 * Minimal application shell painted before the full App chunk resolves. Iframe
 * remounts after display-scale reload must expose `app-shell` within seconds;
 * the App import graph must not occupy that window.
 */
export function ApplicationFirstPaint({ onReload }: { onReload?: () => void } = {}): ReactElement {
    if (onReload) {
        return (
            <DesktopStartupError
                onReload={onReload}
                message="The application did not finish loading. Reload Sourdaw to try again."
            />
        );
    }
    return (
        <div
            className="h-screen w-screen overflow-hidden bg-surface-app"
            data-testid="app-shell"
            style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}
        />
    );
}
