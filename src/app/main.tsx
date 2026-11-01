import { mountBrowserDisplayScaleHost, resetBrowserDisplayScaleForChildStartup } from './browserDisplayScaleHost';
import { reloadApplication } from './reloadApplication';
import { resolveAppComposition } from './resolveAppComposition';

// Only a failed entry graph before this boundary is safe to reload automatically.
document.documentElement.setAttribute('data-sourdaw-entry-started', '');

const root = document.getElementById('root')!;

function paintAppShellMarker(container: HTMLElement): void {
    document.documentElement.style.height = '100%';
    document.documentElement.style.margin = '0';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.width = '100%';
    document.body.style.height = '100%';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.width = '100%';

    const shell = document.createElement('div');
    shell.setAttribute('data-testid', 'app-shell');
    shell.style.width = '100vw';
    shell.style.height = '100vh';
    shell.style.overflow = 'hidden';
    const startup = container.querySelector('#entry-startup');
    if (startup !== null) {
        shell.append(startup);
    }
    container.replaceChildren(shell);
}

const hasDesktopBridge = 'sourdaw' in window;
const composition = resolveAppComposition({
    hasDesktopBridge,
    // CI browser shards serve an e2e-mode production build, which must honour the direct test viewport too.
    isDevelopment: import.meta.env.DEV || import.meta.env.MODE === 'e2e',
    isTopLevel: window.parent === window,
    protocol: window.location.protocol,
    userAgent: navigator.userAgent,
    windowName: window.name,
});

async function renderApplication(): Promise<void> {
    if (hasDesktopBridge) {
        const [{ resetDisplayScaleForStartup }, { clearInheritedRetrospectiveCaptureArm }] = await Promise.all([
            import('#/modules/WorkspaceShell/useCases'),
            import('./clearInheritedRetrospectiveCaptureArm'),
        ]);
        // Before anything renders, so it is ordered ahead of every arm this
        // renderer can issue.
        clearInheritedRetrospectiveCaptureArm();
        await resetDisplayScaleForStartup();
    } else {
        resetBrowserDisplayScaleForChildStartup();
        paintAppShellMarker(root);
    }

    // A remounted iframe has a 5s window for AppShell. Bootstrap's import graph
    // includes WASM and must not occupy that window; AppShell effects await init.
    void import('./bootstrap').catch((error: unknown) => {
        void import('./rejectIdentityTransitionOnBootstrapFailure')
            .then(({ rejectIdentityTransitionOnBootstrapFailure: reject }) => {
                reject(error);
            })
            .catch(() => {
                void import('#/modules/Project/useCases').then(({ failProjectIdentityTransitionDependencies }) => {
                    failProjectIdentityTransitionDependencies(error);
                });
            });
    });
    const renderingModules = await Promise.all([
        import('#/styles/main.css'),
        import('react-dom/client'),
        import('./ApplicationFirstPaint'),
        import('./registerNotificationEventBus'),
    ]).catch((error: unknown) => {
        window.dispatchEvent(new Event('sourdaw:initial-render-failed'));
        reportError(error);
    });
    if (renderingModules === undefined) {
        return;
    }
    const [, { createRoot }, { ApplicationFirstPaint }, { registerNotificationEventBus }] = renderingModules;
    registerNotificationEventBus();
    const reactRoot = createRoot(root);
    reactRoot.render(<ApplicationFirstPaint />);
    // The identical specifier preserves evaluated module identities; retry only
    // this graph's failed fetch, without replaying any startup work above.
    void import('./App')
        .catch(async () => {
            // A rejected graph can still have failing sibling fetches in flight.
            // Give their module-map entries time to settle before the sole retry.
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
            return import('./App');
        })
        .then(
            ({ App }) => reactRoot.render(<App />),
            (error: unknown) => {
                reportError(error);
                reactRoot.render(<ApplicationFirstPaint onReload={() => reloadApplication(window.location)} />);
            }
        );
}

async function renderDesktopStartupError(): Promise<void> {
    const [, { createRoot }, { DesktopStartupError }] = await Promise.all([
        import('#/styles/main.css'),
        import('react-dom/client'),
        import('./DesktopStartupError'),
    ]);
    createRoot(root).render(<DesktopStartupError onReload={() => reloadApplication(window.location)} />);
}

if (composition === 'browser-host') {
    mountBrowserDisplayScaleHost(root);
} else if (composition === 'desktop-startup-error') {
    void renderDesktopStartupError();
} else {
    void renderApplication();
}
