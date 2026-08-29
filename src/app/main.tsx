import { mountBrowserDisplayScaleHost } from './browserDisplayScaleHost';

const root = document.getElementById('root')!;
const isDirectE2EViewport = import.meta.env.MODE === 'e2e' && window.name === 'sourdaw-e2e-direct';
const shouldHostBrowserViewport = !isDirectE2EViewport && !('sourdaw' in window) && window.parent === window;

async function renderApplication(): Promise<void> {
    const [, , { createRoot }, { App }] = await Promise.all([
        import('./bootstrap'),
        import('#/styles/main.css'),
        import('react-dom/client'),
        import('./App'),
    ]);
    createRoot(root).render(<App />);
}

if (shouldHostBrowserViewport) {
    mountBrowserDisplayScaleHost(root);
} else {
    void renderApplication();
}
