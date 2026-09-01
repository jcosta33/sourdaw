import { beforeEach, describe, expect, it, vi } from 'vitest';

const INIT_ERROR_TOAST = 'App failed to load — please reload the page.';

const mocks = vi.hoisted(() => ({
    bootstrap: vi.fn(),
    bootstrapFailure: null as Error | null,
    failIdentityTransition: vi.fn(),
    mountBrowserDisplayScaleHost: vi.fn(),
    render: vi.fn(),
    resetBrowserDisplayScaleForChildStartup: vi.fn(),
    resetDisplayScaleForStartup: vi.fn(),
    resolveAppComposition: vi.fn(),
}));

vi.mock('../bootstrap', () => {
    mocks.bootstrap();
    if (mocks.bootstrapFailure) {
        throw mocks.bootstrapFailure;
    }
    return new Promise<Record<string, never>>(() => undefined);
});

vi.mock('../browserDisplayScaleHost', () => ({
    mountBrowserDisplayScaleHost: mocks.mountBrowserDisplayScaleHost,
    resetBrowserDisplayScaleForChildStartup: mocks.resetBrowserDisplayScaleForChildStartup,
}));

vi.mock('../resolveAppComposition', () => ({
    resolveAppComposition: mocks.resolveAppComposition,
}));

vi.mock('../reloadApplication', () => ({ reloadApplication: vi.fn() }));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    resetDisplayScaleForStartup: mocks.resetDisplayScaleForStartup,
}));

vi.mock('#/modules/Project/useCases', () => ({
    failProjectIdentityTransitionDependencies: mocks.failIdentityTransition,
}));

vi.mock('../App', () => ({ App: () => null }));

vi.mock('react-dom/client', () => ({
    createRoot: () => ({ render: mocks.render }),
}));

describe('app main first paint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        mocks.bootstrapFailure = null;
        Reflect.deleteProperty(window, 'sourdaw');
        window.name = '';
        document.body.innerHTML = '<div id="root"></div>';
        mocks.resolveAppComposition.mockReturnValue('application');
    });

    it('renders the child application while bootstrap is still loading', async () => {
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => resolve());
        });

        await import('../main');
        await rendered;

        expect(mocks.render).toHaveBeenCalledOnce();
        expect(mocks.resetBrowserDisplayScaleForChildStartup).toHaveBeenCalledOnce();
        expect(mocks.bootstrap).toHaveBeenCalledOnce();
        expect(mocks.failIdentityTransition).not.toHaveBeenCalled();
        expect(document.getElementById('root')).not.toBeNull();
    });

    it('fails identity-transition configuration closed when bootstrap import rejects', async () => {
        const failure = new Error('bootstrap chunk failed');
        mocks.bootstrapFailure = failure;
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => resolve());
        });

        await import('../main');
        await rendered;
        await vi.waitFor(() => {
            expect(mocks.failIdentityTransition).toHaveBeenCalledOnce();
        });
        const [reason] = mocks.failIdentityTransition.mock.calls[0] as [Error];
        expect(reason.cause).toBe(failure);
        expect(mocks.render).toHaveBeenCalledOnce();
    });

    it('surfaces the init error toast on a working bus when bootstrap import rejects', async () => {
        const failure = new Error('bootstrap chunk failed');
        mocks.bootstrapFailure = failure;
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => resolve());
        });

        await import('../main');
        await rendered;
        await vi.waitFor(() => {
            expect(mocks.failIdentityTransition).toHaveBeenCalledOnce();
        });

        const { onNotification } = await import('#/infra/dialogService/onNotification');
        const { notifyUser } = await import('#/utils/Notification/notifyUser');
        const received: Array<{ message: string; level: string }> = [];
        const unsubscribe = onNotification((payload) => {
            received.push(payload);
        });
        try {
            notifyUser(INIT_ERROR_TOAST, 'error');
            expect(received).toContainEqual({ message: INIT_ERROR_TOAST, level: 'error' });
        } finally {
            unsubscribe();
        }
    });
});
