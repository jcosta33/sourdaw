import { mountBrowserDisplayScaleHost } from './browserDisplayScaleHost';
import { shouldHostBrowserViewport } from './shouldHostBrowserViewport';

const root = document.getElementById('root')!;
const hostsBrowserViewport = shouldHostBrowserViewport({
    isDevelopment: import.meta.env.DEV,
    isDesktopRuntime: 'sourdaw' in window,
    isTopLevel: window.parent === window,
    windowName: window.name,
});

async function renderApplication(): Promise<void> {
    const [, , { createRoot }, { App }] = await Promise.all([
        import('./bootstrap'),
        import('#/styles/main.css'),
        import('react-dom/client'),
        import('./App'),
    ]);
    createRoot(root).render(<App />);
}

if (hostsBrowserViewport) {
    mountBrowserDisplayScaleHost(root);
} else {
    void renderApplication();
}
