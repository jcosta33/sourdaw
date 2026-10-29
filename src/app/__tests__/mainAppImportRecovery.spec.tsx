import { act, isValidElement } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Root } from 'react-dom/client';

const retryKey = 'sourdaw:app-import-retry-v1';
const bootstrapAttribute = 'data-sourdaw-bootstrap-started';
const appRenderAttribute = 'data-sourdaw-app-render-issued';
const retryIssuedAttribute = 'data-sourdaw-app-import-retry-issued';
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');

const mocks = vi.hoisted(() => ({
    appRequested: vi.fn(),
    appPromise: null as Promise<{ App: () => null }> | null,
    bootstrap: vi.fn(),
    bootstrapFailure: null as Error | null,
    bootstrapPending: true,
    registerBuses: vi.fn(),
    rejectBootstrap: vi.fn(),
    reload: vi.fn(),
    render: vi.fn(),
    renderError: vi.fn(),
    renderWithoutAct: false,
    resetBrowserScale: vi.fn(),
    roots: [] as Root[],
}));

vi.mock('../browserDisplayScaleHost', () => ({
    mountBrowserDisplayScaleHost: vi.fn(),
    resetBrowserDisplayScaleForChildStartup: mocks.resetBrowserScale,
}));
vi.mock('../resolveAppComposition', () => ({ resolveAppComposition: () => 'application' }));
vi.mock('../reloadApplication', () => ({ reloadApplication: mocks.reload }));
vi.mock('../registerNotificationEventBus', () => ({ registerNotificationEventBus: mocks.registerBuses }));
vi.mock('../clearInheritedRetrospectiveCaptureArm', () => ({ clearInheritedRetrospectiveCaptureArm: vi.fn() }));
vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    resetDisplayScaleForStartup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/styles/main.css', () => ({}));
vi.mock('../rejectIdentityTransitionOnBootstrapFailure', () => ({
    rejectIdentityTransitionOnBootstrapFailure: mocks.rejectBootstrap,
}));
vi.mock('react-dom/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom/client')>();
    return {
        createRoot: (container: Parameters<typeof actual.createRoot>[0]) => {
            const root = actual.createRoot(container, { onUncaughtError: mocks.renderError });
            mocks.roots.push(root);
            return {
                render: (element: Parameters<typeof root.render>[0]) => {
                    mocks.render(element);
                    if (mocks.renderWithoutAct) {
                        root.render(element);
                    } else {
                        act(() => root.render(element));
                    }
                },
            };
        },
    };
});

function gateApp() {
    let resolve: (value: { App: () => null }) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    mocks.appPromise = new Promise<{ App: () => null }>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    return { resolve, reject, promise: mocks.appPromise };
}

function installRuntimeMocks(): void {
    vi.doMock('../bootstrap', () => {
        mocks.bootstrap();
        if (mocks.bootstrapFailure !== null) {
            throw mocks.bootstrapFailure;
        }
        return mocks.bootstrapPending ? new Promise<Record<string, never>>(() => undefined) : {};
    });
    vi.doMock('../App', () => ({
        __esModule: true,
        then(onFulfilled: (value: { App: () => null }) => unknown, onRejected?: (reason: unknown) => unknown) {
            mocks.appRequested();
            if (mocks.appPromise === null) {
                throw new Error('App import was not gated');
            }
            return mocks.appPromise.then(onFulfilled, onRejected);
        },
    }));
}

async function firstPaint(): Promise<void> {
    await import('../main');
    await vi.waitFor(() => {
        expect(mocks.appRequested).toHaveBeenCalledOnce();
        expect(document.querySelector('[data-testid="app-shell"]')).not.toBeNull();
    });
    expect(mocks.registerBuses).toHaveBeenCalledOnce();
    expect(mocks.registerBuses.mock.invocationCallOrder[0]).toBeLessThan(mocks.render.mock.invocationCallOrder[0]!);
}

function appWasIssued(): boolean {
    return mocks.render.mock.calls.some(([element]) => isValidElement(element) && element.type === App);
}

function App(): null {
    return null;
}

describe('initial App import recovery through main', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.resetModules();
        mocks.render.mockReset();
        mocks.renderWithoutAct = false;
        installRuntimeMocks();
        if (storageDescriptor === undefined) {
            throw new Error('The browser storage descriptor is absent');
        }
        Object.defineProperty(window, 'sessionStorage', storageDescriptor);
        window.sessionStorage.clear();
        mocks.bootstrapFailure = null;
        mocks.bootstrapPending = true;
        mocks.appPromise = null;
        mocks.roots = [];
        Reflect.deleteProperty(window, 'sourdaw');
        document.documentElement.removeAttribute(bootstrapAttribute);
        document.documentElement.removeAttribute(appRenderAttribute);
        document.documentElement.removeAttribute(retryIssuedAttribute);
        document.body.innerHTML = '<div id="root"></div>';
        window.name = 'sourdaw-application';
        window.history.replaceState(null, '', '/?retained=startup#position');
    });

    afterEach(() => {
        for (const root of mocks.roots) {
            act(() => root.unmount());
        }
        if (storageDescriptor !== undefined) {
            Object.defineProperty(window, 'sessionStorage', storageDescriptor);
        }
        vi.restoreAllMocks();
    });

    it('defers bootstrap and retries a rejected initial graph only after confirming its budget', async () => {
        const app = gateApp();
        await firstPaint();
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(appWasIssued()).toBe(false);
        const location = window.location.href;
        const name = window.name;
        const reads = vi.spyOn(Storage.prototype, 'getItem');
        const writes = vi.spyOn(Storage.prototype, 'setItem');
        app.reject(new Error('App graph request failed'));
        await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
        expect(mocks.reload).toHaveBeenCalledWith(window.location);
        expect(reads.mock.calls.filter(([key]) => key === retryKey)).toHaveLength(2);
        expect(writes).toHaveBeenCalledWith(retryKey, 'used');
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(appWasIssued()).toBe(false);
        expect(window.location.href).toBe(location);
        expect(window.name).toBe(name);
    });

    it('starts bootstrap before issuing App without waiting for bootstrap to finish', async () => {
        const app = gateApp();
        await firstPaint();
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        mocks.render.mockImplementation((element) => {
            if (isValidElement(element) && element.type === App) {
                expect(document.documentElement.hasAttribute(bootstrapAttribute)).toBe(true);
                expect(document.documentElement.hasAttribute(appRenderAttribute)).toBe(true);
            }
        });
        app.resolve({ App });
        await vi.waitFor(() => {
            expect(appWasIssued()).toBe(true);
            expect(mocks.bootstrap).toHaveBeenCalledOnce();
        });
        expect(mocks.reload).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(retryKey)).toBeNull();
    });

    it.each(['used', 'corrupt'])('shows a manual reload when the budget is %s', async (budget) => {
        const app = gateApp();
        window.sessionStorage.setItem(retryKey, budget);
        window.sessionStorage.setItem('sourdaw-undo-session', 'retained history');
        window.sessionStorage.setItem('sourdaw:entry-load-retry-v1', 'retained entry budget');
        await firstPaint();
        app.reject(new Error('App graph request failed'));
        await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
        expect(mocks.reload).not.toHaveBeenCalled();
        const button = document.querySelector('button');
        if (button === null) {
            throw new Error('The startup failure has no reload button');
        }
        expect(button.textContent).toBe('Reload Sourdaw');
        act(() => button.click());
        expect(mocks.reload).toHaveBeenCalledOnce();
        expect(window.sessionStorage.getItem(retryKey)).toBeNull();
        expect(window.sessionStorage.getItem('sourdaw-undo-session')).toBe('retained history');
        expect(window.sessionStorage.getItem('sourdaw:entry-load-retry-v1')).toBe('retained entry budget');
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(appWasIssued()).toBe(false);
    });

    it.each(['unavailable', 'unwritable', 'unconfirmed', 'unreadable'])(
        'fails closed to visible reload when storage is %s',
        async (failure) => {
            const app = gateApp();
            await firstPaint();
            if (failure === 'unavailable') {
                Object.defineProperty(window, 'sessionStorage', {
                    configurable: true,
                    get: () => {
                        throw new Error('unavailable');
                    },
                });
            } else if (failure === 'unwritable') {
                vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                    throw new Error('unwritable');
                });
            } else if (failure === 'unconfirmed') {
                vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
            } else {
                vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                    throw new Error('unreadable');
                });
            }
            app.reject(new Error('App graph request failed'));
            await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
            expect(document.querySelector('button')?.textContent).toBe('Reload Sourdaw');
            expect(mocks.reload).not.toHaveBeenCalled();
            expect(mocks.bootstrap).not.toHaveBeenCalled();
            expect(appWasIssued()).toBe(false);
        }
    );

    it.each([bootstrapAttribute, appRenderAttribute])(
        'refuses automatic recovery after prior %s',
        async (attribute) => {
            document.documentElement.setAttribute(attribute, '');
            const app = gateApp();
            await firstPaint();
            app.reject(new Error('App graph request failed'));
            await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
            expect(mocks.reload).not.toHaveBeenCalled();
            expect(window.sessionStorage.getItem(retryKey)).toBeNull();
        }
    );

    it('never automatically reloads a desktop renderer', async () => {
        Reflect.set(window, 'sourdaw', {});
        const app = gateApp();
        await firstPaint();
        app.reject(new Error('App graph request failed'));
        await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
        expect(mocks.reload).not.toHaveBeenCalled();
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(retryKey)).toBeNull();
    });

    it('does not recover an App import when bootstrap import fails', async () => {
        mocks.bootstrapFailure = new Error('bootstrap failed');
        const app = gateApp();
        await firstPaint();
        app.resolve({ App });
        await vi.waitFor(() => expect(mocks.rejectBootstrap).toHaveBeenCalledOnce());
        expect(appWasIssued()).toBe(true);
        expect(mocks.reload).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(retryKey)).toBeNull();
    });

    it('keeps a retrying document terminal when another App import succeeds later', async () => {
        mocks.bootstrapPending = false;
        const failed = gateApp();
        await firstPaint();
        for (const root of mocks.roots) {
            act(() => root.unmount());
        }
        mocks.roots = [];
        document.body.innerHTML = '<div id="root"></div>';
        vi.resetModules();
        installRuntimeMocks();
        const later = gateApp();
        await import('../main');
        await vi.waitFor(() => expect(mocks.appRequested).toHaveBeenCalledTimes(2));
        failed.reject(new Error('first App import failed'));
        await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
        expect(document.documentElement.hasAttribute(retryIssuedAttribute)).toBe(true);
        later.resolve({ App });
        await vi.dynamicImportSettled();
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(appWasIssued()).toBe(false);
        expect(mocks.reload).toHaveBeenCalledOnce();
        expect(document.documentElement.hasAttribute(bootstrapAttribute)).toBe(false);
    });

    it('does not retry when the imported App fails during rendering', async () => {
        mocks.bootstrapPending = false;
        const app = gateApp();
        await firstPaint();
        mocks.renderWithoutAct = true;
        const error = new Error('App render failed');
        function BrokenApp(): null {
            throw error;
        }
        app.resolve({ App: BrokenApp });
        await vi.waitFor(() => expect(mocks.renderError).toHaveBeenCalledWith(error, expect.anything()));
        expect(document.documentElement.hasAttribute(appRenderAttribute)).toBe(true);
        expect(mocks.reload).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(retryKey)).toBeNull();
    });
});
