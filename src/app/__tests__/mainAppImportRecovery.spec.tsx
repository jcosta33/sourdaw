import { act, isValidElement } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Root } from 'react-dom/client';

const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
const mocks = vi.hoisted(() => ({
    appRequested: vi.fn(),
    importRejections: [] as unknown[],
    appPromise: null as Promise<{ App: () => null }> | null,
    bootstrap: vi.fn(),
    bootstrapFailure: null as Error | null,
    bootstrapPending: true,
    registerBuses: vi.fn(),
    rejectBootstrap: vi.fn(),
    reload: vi.fn(),
    render: vi.fn(),
    renderError: vi.fn(),
    reportError: vi.fn(),
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
    return { resolve, reject };
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
            return mocks.appPromise.then(onFulfilled, (error: unknown) => {
                if (onRejected === undefined) {
                    throw error;
                }
                try {
                    return onRejected(error);
                } catch (error) {
                    // Vitest wraps rejected mock factories before the actual import rejects.
                    mocks.importRejections.push(error);
                    throw error;
                }
            });
        },
    }));
}
async function firstPaint(): Promise<void> {
    await import('../main');
    await vi.waitFor(() => {
        expect(mocks.appRequested).toHaveBeenCalledOnce();
        expect(document.querySelector('[data-testid="app-shell"]')).not.toBeNull();
        expect(mocks.bootstrap).toHaveBeenCalledOnce();
    });
    expect(mocks.registerBuses).toHaveBeenCalledOnce();
    expect(mocks.registerBuses.mock.invocationCallOrder[0]).toBeLessThan(mocks.render.mock.invocationCallOrder[0]!);
}
function App(): null {
    return null;
}
function appWasIssued(): boolean {
    return mocks.render.mock.calls.some(([element]) => isValidElement(element) && element.type === App);
}
function expectTerminalReport(firstReason: unknown, secondReason: unknown): void {
    expect(mocks.reportError).toHaveBeenCalledOnce();
    const reported: unknown = mocks.reportError.mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(AggregateError);
    if (!(reported instanceof AggregateError)) {
        throw new Error('Terminal App causes were not reported');
    }
    expect(reported.message).toBe('Sourdaw App import failed after its single retry');
    expect(reported.errors).toHaveLength(2);
    expect(mocks.importRejections).toHaveLength(2);
    const [firstImportRejection, secondImportRejection] = mocks.importRejections;
    if (!(firstImportRejection instanceof Error) || !(secondImportRejection instanceof Error)) {
        throw new Error('The mock import did not expose both rejection objects');
    }
    expect(firstImportRejection).not.toBe(secondImportRejection);
    expect(firstImportRejection.cause).toBe(firstReason);
    expect(secondImportRejection.cause).toBe(secondReason);
    expect(reported.errors[0]).toBe(firstImportRejection);
    expect(reported.errors[1]).toBe(secondImportRejection);
}
async function rejectAppTwice(firstReason: unknown, secondReason: unknown): Promise<void> {
    const first = gateApp();
    await firstPaint();
    first.reject(firstReason);
    const retry = gateApp();
    await vi.waitFor(() => expect(mocks.appRequested).toHaveBeenCalledTimes(2));
    expect(mocks.reportError).not.toHaveBeenCalled();
    retry.reject(secondReason);
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expectTerminalReport(firstReason, secondReason);
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
        mocks.importRejections = [];
        mocks.roots = [];
        Reflect.deleteProperty(window, 'sourdaw');
        document.body.innerHTML = '<div id="root"></div>';
        window.name = 'sourdaw-application';
        window.history.replaceState(null, '', '/?retained=startup#position');
        vi.stubGlobal('reportError', mocks.reportError);
    });
    afterEach(() => {
        for (const root of mocks.roots) {
            act(() => root.unmount());
        }
        if (storageDescriptor !== undefined) {
            Object.defineProperty(window, 'sessionStorage', storageDescriptor);
        }
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('starts bootstrap and first paint while App and bootstrap completion remain held', async () => {
        const app = gateApp();
        await firstPaint();
        expect(appWasIssued()).toBe(false);
        expect(mocks.reportError).not.toHaveBeenCalled();
        app.resolve({ App });
        await vi.waitFor(() => expect(appWasIssued()).toBe(true));
        expect(mocks.bootstrap).toHaveBeenCalledOnce();
        expect(mocks.reload).not.toHaveBeenCalled();
    });

    it('recovers a failed fetch in the same document without reporting a successful retry', async () => {
        const first = gateApp();
        await firstPaint();
        const identity = { document, location: window.location.href, name: window.name };
        first.reject(new TypeError('first App fetch failed'));
        const retry = gateApp();
        await vi.waitFor(() => expect(mocks.appRequested).toHaveBeenCalledTimes(2));
        retry.resolve({ App });
        await vi.waitFor(() => expect(appWasIssued()).toBe(true));
        expect(mocks.reportError).not.toHaveBeenCalled();
        expect(mocks.reload).not.toHaveBeenCalled();
        expect(mocks.roots).toHaveLength(1);
        expect(mocks.bootstrap).toHaveBeenCalledOnce();
        expect(mocks.registerBuses).toHaveBeenCalledOnce();
        expect(document).toBe(identity.document);
        expect(window.location.href).toBe(identity.location);
        expect(window.name).toBe(identity.name);
    });

    it('reports both distinct rejection objects once and retains the same manual fallback', async () => {
        window.sessionStorage.setItem('sourdaw-undo-session', 'retained history');
        window.sessionStorage.setItem('sourdaw:entry-load-retry-v1', 'retained entry budget');
        const firstReason = new TypeError('initial fetch failed');
        const secondReason = new SyntaxError('retry evaluation failed');
        await rejectAppTwice(firstReason, secondReason);
        expect(mocks.appRequested).toHaveBeenCalledTimes(2);
        expect(mocks.roots).toHaveLength(1);
        expect(mocks.bootstrap).toHaveBeenCalledOnce();
        expect(appWasIssued()).toBe(false);
        expect(mocks.reload).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain(
            'The application did not finish loading. Reload Sourdaw to try again.'
        );
        const button = document.querySelector('button');
        if (button === null) {
            throw new Error('The startup failure has no reload button');
        }
        expect(button.textContent).toBe('Reload Sourdaw');
        act(() => button.click());
        expect(mocks.reload).toHaveBeenCalledOnce();
        expect(mocks.reload).toHaveBeenCalledWith(window.location);
        expect(window.sessionStorage.getItem('sourdaw-undo-session')).toBe('retained history');
        expect(window.sessionStorage.getItem('sourdaw:entry-load-retry-v1')).toBe('retained entry budget');
        expectTerminalReport(firstReason, secondReason);
    });

    it.each(['unavailable', 'unwritable', 'unconfirmed', 'unreadable'])(
        'keeps manual recovery independent of %s session storage',
        async (failure) => {
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
            await rejectAppTwice(new Error('initial fetch failed'), new Error('retry fetch failed'));
            expect(document.querySelector('button')?.textContent).toBe('Reload Sourdaw');
            expect(mocks.reload).not.toHaveBeenCalled();
        }
    );

    it('keeps bootstrap failure identity separate from a successful App import', async () => {
        const failure = new Error('bootstrap failed');
        mocks.bootstrapFailure = failure;
        const app = gateApp();
        await firstPaint();
        app.resolve({ App });
        await vi.waitFor(() => expect(mocks.rejectBootstrap).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(appWasIssued()).toBe(true));
        const rejected: unknown = mocks.rejectBootstrap.mock.calls[0]?.[0];
        expect(rejected).toBeInstanceOf(Error);
        if (!(rejected instanceof Error)) {
            throw new Error('Bootstrap failure identity is absent');
        }
        expect(rejected.cause).toBe(failure);
        expect(mocks.reportError).not.toHaveBeenCalled();
        expect(mocks.reload).not.toHaveBeenCalled();
    });

    it('does not retry or report an import failure when the imported App throws while rendering', async () => {
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
        expect(mocks.appRequested).toHaveBeenCalledOnce();
        expect(mocks.reportError).not.toHaveBeenCalled();
        expect(mocks.reload).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')).toBeNull();
    });
});
