import { mountBrowserDisplayScaleHost } from './browserDisplayScaleHost';
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
    }

    const [, , { createRoot }, { App }] = await Promise.all([
        import('./bootstrap'),
        import('#/styles/main.css'),
        import('react-dom/client'),
        import('./App'),
    ]);
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
