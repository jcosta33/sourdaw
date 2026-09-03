import { mountBrowserDisplayScaleHost, resetBrowserDisplayScaleForChildStartup } from './browserDisplayScaleHost';
import { reloadApplication } from './reloadApplication';
import { resolveAppComposition } from './resolveAppComposition';

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
    const [, { createRoot }, { ApplicationFirstPaint }, { registerNotificationEventBus }] = await Promise.all([
        import('#/styles/main.css'),
        import('react-dom/client'),
        import('./ApplicationFirstPaint'),
        import('./registerNotificationEventBus'),
    ]);
    registerNotificationEventBus();
    const reactRoot = createRoot(root);
    reactRoot.render(<ApplicationFirstPaint />);
    void import('./App').then(({ App }) => {
        reactRoot.render(<App />);
    });
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
