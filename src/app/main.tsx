import { mountBrowserDisplayScaleHost, resetBrowserDisplayScaleForChildStartup } from './browserDisplayScaleHost';
import { reloadApplication } from './reloadApplication';
import { resolveAppComposition } from './resolveAppComposition';

const root = document.getElementById('root')!;
const hasDesktopBridge = 'sourdaw' in window;
const composition = resolveAppComposition({
    hasDesktopBridge,
    isDevelopment: import.meta.env.DEV,
    isTopLevel: window.parent === window,
    protocol: window.location.protocol,
    userAgent: navigator.userAgent,
    windowName: window.name,
});

async function renderApplication(): Promise<void> {
    if (hasDesktopBridge) {
        const { resetDisplayScaleForStartup } = await import('#/modules/WorkspaceShell/useCases');
        await resetDisplayScaleForStartup();
    } else {
        resetBrowserDisplayScaleForChildStartup();
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
    const [, { createRoot }, { App }, { registerNotificationEventBus }] = await Promise.all([
        import('#/styles/main.css'),
        import('react-dom/client'),
        import('./App'),
        import('./registerNotificationEventBus'),
    ]);
    registerNotificationEventBus();
    createRoot(root).render(<App />);
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
