import { isValidElement } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bootstrap: vi.fn(),
    desktopStartupError: vi.fn(() => null),
    mountBrowserDisplayScaleHost: vi.fn(),
    reloadApplication: vi.fn(),
    render: vi.fn(),
    resetBrowserDisplayScaleForChildStartup: vi.fn(),
    resetDisplayScaleForStartup: vi.fn(),
    resolveAppComposition: vi.fn(),
}));

vi.mock('../bootstrap', () => {
    mocks.bootstrap();
    return {};
});

vi.mock('../browserDisplayScaleHost', () => ({
    mountBrowserDisplayScaleHost: mocks.mountBrowserDisplayScaleHost,
    resetBrowserDisplayScaleForChildStartup: mocks.resetBrowserDisplayScaleForChildStartup,
}));

vi.mock('../DesktopStartupError', () => ({ DesktopStartupError: mocks.desktopStartupError }));

vi.mock('../resolveAppComposition', () => ({
    resolveAppComposition: mocks.resolveAppComposition,
}));

vi.mock('../reloadApplication', () => ({ reloadApplication: mocks.reloadApplication }));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    resetDisplayScaleForStartup: mocks.resetDisplayScaleForStartup,
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

        expect(mocks.resolveAppComposition).toHaveBeenCalledWith({
            hasDesktopBridge: false,
            isDevelopment: import.meta.env.DEV,
            isTopLevel: window.parent === window,
            protocol: window.location.protocol,
            userAgent: navigator.userAgent,
            windowName: '',
        });
        expect(mocks.mountBrowserDisplayScaleHost).toHaveBeenCalledWith(document.getElementById('root'));
        expect(mocks.resetBrowserDisplayScaleForChildStartup).not.toHaveBeenCalled();
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it('initializes the application directly in a desktop renderer', async () => {
        Reflect.set(window, 'sourdaw', {});
        mocks.resolveAppComposition.mockReturnValue('application');
        let finishReset: (() => void) | undefined;
        mocks.resetDisplayScaleForStartup.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishReset = resolve;
            })
        );

        const mainImport = import('../main');

        await vi.waitFor(() => expect(mocks.resetDisplayScaleForStartup).toHaveBeenCalledOnce());
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
        if (finishReset === undefined) {
            throw new Error('Display scale reset did not expose its completion');
        }
        finishReset();
        await mainImport;

        await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
        const resetCallOrder = mocks.resetDisplayScaleForStartup.mock.invocationCallOrder[0];
        const renderCallOrder = mocks.render.mock.invocationCallOrder[0];
        expect(resetCallOrder).toBeDefined();
        expect(renderCallOrder).toBeDefined();
        if (resetCallOrder === undefined || renderCallOrder === undefined) {
            throw new Error('Display scale reset or application render did not run');
        }
        expect(resetCallOrder).toBeLessThan(renderCallOrder);
        expect(mocks.resetBrowserDisplayScaleForChildStartup).not.toHaveBeenCalled();
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
    });

    it('resets the browser host before importing and rendering a child application', async () => {
        mocks.resolveAppComposition.mockReturnValue('application');
        mocks.resetBrowserDisplayScaleForChildStartup.mockImplementationOnce(() => {
            expect(mocks.bootstrap).not.toHaveBeenCalled();
            expect(mocks.render).not.toHaveBeenCalled();
        });

        await import('../main');

        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
        expect(mocks.resetBrowserDisplayScaleForChildStartup).toHaveBeenCalledOnce();
        expect(mocks.resetDisplayScaleForStartup).not.toHaveBeenCalled();
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
    });

    it('renders only the fatal startup surface when a desktop document has no bridge', async () => {
        mocks.resolveAppComposition.mockReturnValue('desktop-startup-error');

        await import('../main');

        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
        const startupError = mocks.render.mock.calls[0]?.[0];
        expect(isValidElement(startupError)).toBe(true);
        if (!isValidElement<{ onReload: () => void }>(startupError)) {
            throw new Error('Desktop startup error did not render a React element');
        }
        expect(startupError.type).toBe(mocks.desktopStartupError);

        startupError.props.onReload();

        expect(mocks.reloadApplication).toHaveBeenCalledWith(window.location);
        expect(mocks.resetBrowserDisplayScaleForChildStartup).not.toHaveBeenCalled();
        expect(mocks.resetDisplayScaleForStartup).not.toHaveBeenCalled();
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
    });
});
