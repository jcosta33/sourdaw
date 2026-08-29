import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bootstrap: vi.fn(),
    mountBrowserDisplayScaleHost: vi.fn(),
    render: vi.fn(),
}));

vi.mock('../bootstrap', () => {
    mocks.bootstrap();
    return {};
});

vi.mock('../browserDisplayScaleHost', () => ({
    mountBrowserDisplayScaleHost: mocks.mountBrowserDisplayScaleHost,
}));

vi.mock('../App', () => ({ App: () => null }));

vi.mock('react-dom/client', () => ({
    createRoot: () => ({ render: mocks.render }),
}));

describe('app main composition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        Reflect.deleteProperty(window, 'sourdaw');
        window.name = '';
        document.body.innerHTML = '<div id="root"></div>';
    });

    afterEach(() => vi.unstubAllEnvs());

    it('mounts only the browser viewport host in the top-level browser document', async () => {
        await import('../main');

        expect(mocks.mountBrowserDisplayScaleHost).toHaveBeenCalledWith(document.getElementById('root'));
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it('initializes the application directly in a desktop renderer', async () => {
        Reflect.set(window, 'sourdaw', {});

        await import('../main');

        await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
    });

    it('initializes the application directly for the e2e Page fixture marker', async () => {
        vi.stubEnv('MODE', 'e2e');
        window.name = 'sourdaw-e2e-direct';

        await import('../main');

        await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
    });
});
