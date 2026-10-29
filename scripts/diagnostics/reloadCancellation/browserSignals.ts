// Playwright serializes this function. Every value it uses belongs to the browser realm.
export function observeBrowserDocument(): void {
    const emit = (kind: string, data: unknown): void => {
        console.debug(
            '[reload-cancellation-observation]',
            JSON.stringify({ kind, data, timeOrigin: performance.timeOrigin, performanceNow: performance.now() })
        );
    };
    emit('document-init', { url: location.href });
    window.addEventListener('error', (event) => {
        emit('window-error', { message: event.message, filename: event.filename, line: event.lineno });
    });
    window.addEventListener('unhandledrejection', (event) => {
        const reason: unknown = event.reason;
        emit('unhandled-rejection', { reason: String(reason) });
    });
    window.addEventListener('beforeunload', () => emit('beforeunload', { url: location.href }));
    window.addEventListener('pagehide', (event) =>
        emit('pagehide', { persisted: event.persisted, url: location.href })
    );
    let previous = '';
    const observe = (): void => {
        const controls = document.querySelector('[role="group"][aria-label="Playback controls"]');
        const style = controls ? getComputedStyle(controls) : undefined;
        const rectangle = controls?.getBoundingClientRect();
        const snapshot = {
            entryStarted: document.documentElement?.hasAttribute('data-sourdaw-entry-started') ?? false,
            shell: document.querySelector('[data-testid="app-shell"]') !== null,
            controlsPresent: controls !== null,
            controlsVisible: Boolean(
                rectangle &&
                rectangle.width > 0 &&
                rectangle.height > 0 &&
                style?.visibility === 'visible' &&
                style.display !== 'none'
            ),
        };
        const encoded = JSON.stringify(snapshot);
        if (encoded !== previous) {
            previous = encoded;
            emit('public-dom-transition', snapshot);
        }
    };
    new MutationObserver(observe).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-sourdaw-entry-started', 'role', 'aria-label', 'hidden', 'style', 'class'],
    });
    observe();
}
