import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bootstrap: vi.fn(),
    desktopStartupError: vi.fn(() => null),
    mountBrowserDisplayScaleHost: vi.fn(),
    render: vi.fn(),
    resolveAppComposition: vi.fn(),
}));

vi.mock('../bootstrap', () => {
    mocks.bootstrap();
    return {};
});

vi.mock('../browserDisplayScaleHost', () => ({
    mountBrowserDisplayScaleHost: mocks.mountBrowserDisplayScaleHost,
}));

vi.mock('../DesktopStartupError', () => ({ DesktopStartupError: mocks.desktopStartupError }));

vi.mock('../resolveAppComposition', () => ({
    resolveAppComposition: mocks.resolveAppComposition,
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
        mocks.resolveAppComposition.mockReturnValue('browser-host');
    });

    it('mounts only the browser viewport host in the top-level browser document', async () => {
        await import('../main');

        expect(mocks.resolveAppComposition).toHaveBeenCalledWith(
            expect.objectContaining({ protocol: window.location.protocol })
        );
        expect(mocks.mountBrowserDisplayScaleHost).toHaveBeenCalledWith(document.getElementById('root'));
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it('initializes the application directly in a desktop renderer', async () => {
        mocks.resolveAppComposition.mockReturnValue('application');

        await import('../main');

        await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
    });

    it('renders only the fatal startup surface when a desktop document has no bridge', async () => {
        mocks.resolveAppComposition.mockReturnValue('desktop-startup-error');

        await import('../main');

        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
        expect(mocks.render.mock.calls[0]?.[0]).toMatchObject({ type: mocks.desktopStartupError });
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
    });
});
