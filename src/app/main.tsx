import { ApplicationStartupError } from './ApplicationStartupError';
import { mountBrowserDisplayScaleHost, resetBrowserDisplayScaleForChildStartup } from './browserDisplayScaleHost';
import {
    APP_RENDER_ISSUED_ATTRIBUTE,
    APP_IMPORT_RETRY_ISSUED_ATTRIBUTE,
    BOOTSTRAP_STARTED_ATTRIBUTE,
    claimInitialAppImportRetry,
    clearInitialAppImportRetry,
} from './initialAppImportRecovery';
import { reloadApplication } from './reloadApplication';
import { resolveAppComposition } from './resolveAppComposition';

// Only a failed entry graph before this boundary is safe to retry automatically.
document.documentElement.setAttribute('data-sourdaw-entry-started', '');
document.getElementById('entry-startup')?.remove();

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
    const [, { createRoot }, { ApplicationFirstPaint }, { registerNotificationEventBus }] = await Promise.all([
        import('#/styles/main.css'),
        import('react-dom/client'),
        import('./ApplicationFirstPaint'),
        import('./registerNotificationEventBus'),
    ]);
    registerNotificationEventBus();
    const reactRoot = createRoot(root);
    reactRoot.render(<ApplicationFirstPaint />);
    void import('./App').then(
        ({ App }) => {
            if (document.documentElement.hasAttribute(APP_IMPORT_RETRY_ISSUED_ATTRIBUTE)) {
                return;
            }
            // Document markers survive module re-evaluation and precede every runtime invocation.
            document.documentElement.setAttribute(BOOTSTRAP_STARTED_ATTRIBUTE, '');
            void import('./bootstrap').catch((error: unknown) => {
                void import('./rejectIdentityTransitionOnBootstrapFailure')
                    .then(({ rejectIdentityTransitionOnBootstrapFailure: reject }) => {
                        reject(error);
                    })
                    .catch(() => {
                        void import('#/modules/Project/useCases').then(
                            ({ failProjectIdentityTransitionDependencies }) => {
                                failProjectIdentityTransitionDependencies(error);
                            }
                        );
                    });
            });
            document.documentElement.setAttribute(APP_RENDER_ISSUED_ATTRIBUTE, '');
            reactRoot.render(<App />);
        },
        () => {
            if (
                claimInitialAppImportRetry({
                    protocol: window.location.protocol,
                    userAgent: navigator.userAgent,
                    hasDesktopBridge,
                    bootstrapStarted: document.documentElement.hasAttribute(BOOTSTRAP_STARTED_ATTRIBUTE),
                    appRenderIssued: document.documentElement.hasAttribute(APP_RENDER_ISSUED_ATTRIBUTE),
                    retryIssued: document.documentElement.hasAttribute(APP_IMPORT_RETRY_ISSUED_ATTRIBUTE),
                    storage: () => window.sessionStorage,
                })
            ) {
                document.documentElement.setAttribute(APP_IMPORT_RETRY_ISSUED_ATTRIBUTE, '');
                reloadApplication(window.location);
                return;
            }
            reactRoot.render(
                <ApplicationStartupError
                    onReload={() => {
                        clearInitialAppImportRetry(() => window.sessionStorage);
                        reloadApplication(window.location);
                    }}
                />
            );
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
