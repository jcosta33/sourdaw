import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, isValidElement } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { onNotification as OnNotification } from '#/infra/dialogService/onNotification';
import type { setVoiceToggleEventBus } from '#/modules/AiRuntime/useCases';
import type { setCommandEventBus } from '#/modules/Command/useCases';
import type { setWebMidiRuntimeEventBus } from '#/modules/MIDI/useCases';
import type { setWorkspaceEventBus } from '#/modules/WorkspaceShell/useCases';

type BoundNotifyBus = {
    on(event: 'ui.notify', handler: (payload: { message: string; level: string }) => void): () => void;
};

const mocks = vi.hoisted(() => {
    const identity = {
        ready: new Promise<void>(() => undefined),
        fail(_reason: unknown): void {
            // replaced by reset()
        },
        reset(): void {
            let rejectReady: (reason: unknown) => void = () => undefined;
            this.ready = new Promise<void>((_resolve, reject) => {
                rejectReady = reject;
            });
            void this.ready.catch(() => undefined);
            this.fail = (reason: unknown): void => {
                rejectReady(reason);
            };
        },
    };
    identity.reset();

    return {
        appImportPending: false,
        appImport: vi.fn(),
        appImportRelease: null as ((value: { App: () => null }) => void) | null,
        appImportPromise: null as Promise<{ App: () => null }> | null,
        bootstrap: vi.fn(),
        bootstrapFailure: null as Error | null,
        criticalPathImportPending: false,
        criticalPathImportPromise: null as Promise<Record<string, never>> | null,
        criticalPathImportRelease: null as (() => void) | null,
        createRoot: vi.fn(),
        failIdentityTransition: vi.fn(),
        identity,
        mountBrowserDisplayScaleHost: vi.fn(),
        onNotification: null as null | typeof OnNotification,
        render: vi.fn(),
        reportError: vi.fn(),
        resetBrowserDisplayScaleForChildStartup: vi.fn(),
        resetDisplayScaleForStartup: vi.fn(),
        resolveAppComposition: vi.fn(),
        sharedEventBus: null as BoundNotifyBus | null,
        setCommandEventBus: vi.fn<typeof setCommandEventBus>(),
        setNotificationEventBus: vi.fn(),
        setVoiceToggleEventBus: vi.fn<typeof setVoiceToggleEventBus>(),
        setWebMidiRuntimeEventBus: vi.fn<typeof setWebMidiRuntimeEventBus>(),
        setWorkspaceEventBus: vi.fn<typeof setWorkspaceEventBus>(),
    };
});

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

vi.mock('#/styles/main.css', () => ({
    __esModule: true,
    then(onFulfilled: (value: Record<string, never>) => unknown, onRejected?: (reason: unknown) => unknown) {
        const cssImport =
            mocks.criticalPathImportPending && mocks.criticalPathImportPromise !== null
                ? mocks.criticalPathImportPromise
                : Promise.resolve({});
        return cssImport.then(onFulfilled, onRejected);
    },
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    setWorkspaceEventBus: mocks.setWorkspaceEventBus,
    onZoomToFit: vi.fn(),
    resetDisplayScaleForStartup: mocks.resetDisplayScaleForStartup,
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    setVoiceToggleEventBus: mocks.setVoiceToggleEventBus,
}));

vi.mock('#/modules/Project/useCases', () => ({
    failProjectIdentityTransitionDependencies: (reason: unknown) => {
        mocks.failIdentityTransition(reason);
        mocks.identity.fail(reason);
    },
    whenProjectIdentityTransitionDependenciesConfigured: () => mocks.identity.ready,
    loadProject: vi.fn(),
    reportProjectLoadFailure: vi.fn(),
    saveProject: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    initializeAudioEngine: vi.fn().mockResolvedValue(undefined),
    disarmRetrospectiveCapture: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    setMasterGainValue: vi.fn(),
    resumeEngine: vi.fn(),
    syncNativeTimelineSamples: vi.fn(() => vi.fn()),
}));

vi.mock('#/modules/Knead/useCases', () => ({ syncKneadToEngine: vi.fn(() => vi.fn()) }));

vi.mock('#/modules/MIDI/useCases', () => ({
    initWebMidi: vi.fn(),
    setWebMidiRuntimeEventBus: mocks.setWebMidiRuntimeEventBus,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    setCommandEventBus: mocks.setCommandEventBus,
}));

vi.mock('#/modules/SampleLibrary/useCases', () => ({
    restoreLibrary: vi.fn().mockResolvedValue(undefined),
    seedFactoryLibrary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/Synth/useCases', () => ({
    registerProSynthInstruments: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: vi.fn(),
    getTransportState: vi.fn(() => null),
    syncTransportMapsToNativeSession: vi.fn(() => vi.fn()),
}));

vi.mock('../App', () => {
    mocks.appImport();
    return {
        __esModule: true,
        then(onFulfilled: (value: { App: () => null }) => unknown, onRejected?: (reason: unknown) => unknown) {
            const appImport =
                mocks.appImportPending && mocks.appImportPromise !== null
                    ? mocks.appImportPromise
                    : Promise.resolve({
                          App: function App() {
                              return null;
                          },
                      });
            return appImport.then(onFulfilled, onRejected);
        },
    };
});

vi.mock('react-dom/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom/client')>();
    const client = {
        createRoot: (container: Parameters<typeof actual.createRoot>[0]) => {
            mocks.createRoot();
            const root = actual.createRoot(container);
            return {
                render: (element: Parameters<typeof root.render>[0]) => {
                    mocks.render(element);
                    act(() => {
                        root.render(element);
                    });
                },
            };
        },
    };
    return {
        __esModule: true,
        ...client,
        then(onFulfilled: (value: typeof client) => unknown, onRejected?: (reason: unknown) => unknown) {
            const clientImport =
                mocks.criticalPathImportPending && mocks.criticalPathImportPromise !== null
                    ? mocks.criticalPathImportPromise.then(() => client)
                    : Promise.resolve(client);
            return clientImport.then(onFulfilled, onRejected);
        },
    };
});

function expectFirstPaintRendered(): void {
    const firstRender = mocks.render.mock.calls[0]?.[0];
    expect(isValidElement(firstRender)).toBe(true);
    if (!isValidElement(firstRender)) {
        throw new Error('Application first paint did not render a React element');
    }
    const componentType = firstRender.type;
    if (typeof componentType !== 'function') {
        throw new TypeError('Application first paint did not render a component');
    }
    expect(componentType.name).toBe('ApplicationFirstPaint');
    expect(document.querySelector('[data-testid="app-shell"]')).not.toBeNull();
}

function expectAppShellMarkerInRoot(): void {
    const root = document.getElementById('root');
    expect(root).not.toBeNull();
    if (root === null) {
        throw new Error('#root was not mounted');
    }
    const shell = root.querySelector('[data-testid="app-shell"]');
    expect(shell).not.toBeNull();
    if (!(shell instanceof HTMLElement)) {
        throw new Error('app-shell marker was not an HTMLElement');
    }
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.margin).toBe('0px');
    expect(document.body.style.overflow).toBe('hidden');
    expect(shell.style.width).toBe('100vw');
    expect(shell.style.height).toBe('100vh');
}

function expectMountBusesBoundBeforeRender(): void {
    expect(mocks.setWorkspaceEventBus).toHaveBeenCalledOnce();
    expect(mocks.setVoiceToggleEventBus).toHaveBeenCalledOnce();
    expect(mocks.setNotificationEventBus).toHaveBeenCalledOnce();
    expect(mocks.setWebMidiRuntimeEventBus).toHaveBeenCalledOnce();
    expect(mocks.setCommandEventBus).toHaveBeenCalledOnce();

    const renderOrder = mocks.render.mock.invocationCallOrder[0];
    expect(renderOrder).toBeDefined();
    if (renderOrder === undefined) {
        throw new Error('createRoot.render did not run');
    }
    for (const setter of [
        mocks.setWorkspaceEventBus,
        mocks.setVoiceToggleEventBus,
        mocks.setNotificationEventBus,
        mocks.setWebMidiRuntimeEventBus,
        mocks.setCommandEventBus,
    ]) {
        const order = setter.mock.invocationCallOrder[0];
        expect(order).toBeDefined();
        if (order === undefined) {
            throw new Error('A first-paint bus setter did not run');
        }
        expect(order).toBeLessThan(renderOrder);
    }

    const boundBus = mocks.sharedEventBus;
    expect(boundBus).not.toBeNull();
    expect(mocks.setWorkspaceEventBus).toHaveBeenCalledWith(boundBus);
    expect(mocks.setVoiceToggleEventBus).toHaveBeenCalledWith(boundBus);
    expect(mocks.setNotificationEventBus).toHaveBeenCalledWith(boundBus);
    expect(mocks.setWebMidiRuntimeEventBus).toHaveBeenCalledWith({ eventBus: boundBus });
    expect(mocks.setCommandEventBus).toHaveBeenCalledWith(boundBus);
}

describe('app main first paint', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        mocks.bootstrapFailure = null;
        mocks.appImportPending = false;
        mocks.appImportRelease = null;
        mocks.appImportPromise = null;
        mocks.criticalPathImportPending = false;
        mocks.criticalPathImportPromise = null;
        mocks.criticalPathImportRelease = null;
        mocks.identity.reset();
        mocks.onNotification = null;
        Reflect.deleteProperty(window, 'sourdaw');
        window.name = '';
        document.documentElement.removeAttribute('data-sourdaw-entry-started');
        const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
        document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
        vi.stubGlobal('reportError', mocks.reportError);
        mocks.resolveAppComposition.mockReturnValue('application');
        try {
            localStorage.setItem('wd:first-load-hint-shown', '1');
        } catch {
            // ignore
        }
        const { Container } = await import('#/infra/di/Container');
        Container.clear();
        const notificationEventBus = await import('#/utils/Notification/notificationEventBus');
        mocks.setNotificationEventBus = vi.spyOn(notificationEventBus, 'setNotificationEventBus');
        const { onNotification } = await import('#/infra/dialogService/onNotification');
        mocks.onNotification = onNotification;
        const { eventBus } = await import('../registerDependencies');
        mocks.sharedEventBus = eventBus;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // Runs first so no prior main import leaves async renderApplication on a stale #root.

    it('exposes app-shell before css, react-dom, and first-paint imports resolve', async () => {
        mocks.resolveAppComposition.mockImplementation(() => {
            expect(document.documentElement.hasAttribute('data-sourdaw-entry-started')).toBe(true);
            expect(document.getElementById('entry-startup')).not.toBeNull();
            return 'application';
        });
        mocks.criticalPathImportPending = true;
        mocks.criticalPathImportPromise = new Promise<Record<string, never>>((resolve) => {
            mocks.criticalPathImportRelease = () => resolve({});
        });

        const mainImport = import('../main');

        await vi.waitFor(() => {
            expect(mocks.resetBrowserDisplayScaleForChildStartup).toHaveBeenCalledOnce();
            expectAppShellMarkerInRoot();
        });
        expect(mocks.render).not.toHaveBeenCalled();
        expect(document.getElementById('entry-startup-title')?.textContent).toBe('Starting Sourdaw');

        const release = mocks.criticalPathImportRelease;
        if (release === null) {
            throw new Error('Critical path imports were not gated');
        }
        release();
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => resolve());
        });
        await mainImport;
        await rendered;
        expectFirstPaintRendered();
        expect(document.getElementById('entry-startup')).toBeNull();
    });

    it('retains manual entry recovery when critical rendering imports reject without starting React or App', async () => {
        const addedListeners = vi.spyOn(window, 'addEventListener');
        window.eval(readFileSync(resolve(process.cwd(), 'public/entryLoadRecovery.js'), 'utf8'));
        const listeners = [...addedListeners.mock.calls];
        addedListeners.mockRestore();
        const failure = new TypeError('critical rendering dependency failed');
        let rejectCritical: (reason: unknown) => void = () => undefined;
        const criticalImport = new Promise<{ registerNotificationEventBus: () => void }>((_resolve, reject) => {
            rejectCritical = reject;
        });
        vi.doMock('../registerNotificationEventBus', () => criticalImport);
        try {
            await import('../main');
            await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledOnce());
            expectAppShellMarkerInRoot();
            expect(document.getElementById('entry-startup-title')?.textContent).toBe('Starting Sourdaw');

            rejectCritical(failure);
            await vi.waitFor(() => expect(mocks.reportError).toHaveBeenCalledOnce());
            const reported = mocks.reportError.mock.calls[0]?.[0];
            if (!(reported instanceof Error)) {
                throw new Error('Critical import failure was not reported');
            }
            expect(reported.cause).toBe(failure);

            expect(document.getElementById('entry-startup-title')?.textContent).toBe('Sourdaw could not start');
            expect(document.querySelector('#entry-startup [role="alert"]')).not.toBeNull();
            expect(document.getElementById('entry-startup-reload')?.hasAttribute('hidden')).toBe(false);
            expect(mocks.reportError).toHaveBeenCalledOnce();
            expect(mocks.bootstrap).toHaveBeenCalledOnce();
            expect(mocks.createRoot).not.toHaveBeenCalled();
            expect(mocks.appImport).not.toHaveBeenCalled();
            expect(mocks.render).not.toHaveBeenCalled();
            expect(mocks.setWorkspaceEventBus).not.toHaveBeenCalled();
            expect(mocks.setVoiceToggleEventBus).not.toHaveBeenCalled();
            expect(mocks.setNotificationEventBus).not.toHaveBeenCalled();
            expect(mocks.setWebMidiRuntimeEventBus).not.toHaveBeenCalled();
            expect(mocks.setCommandEventBus).not.toHaveBeenCalled();
        } finally {
            vi.doUnmock('../registerNotificationEventBus');
            for (const [type, listener, options] of listeners) {
                window.removeEventListener(type, listener, options);
            }
        }
    });

    it('renders the child application while bootstrap is still loading', async () => {
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => resolve());
        });

        await import('../main');
        await rendered;

        expect(mocks.render).toHaveBeenCalled();
        expectFirstPaintRendered();
        expect(mocks.resetBrowserDisplayScaleForChildStartup).toHaveBeenCalledOnce();
        expect(mocks.bootstrap).toHaveBeenCalledOnce();
        expect(mocks.failIdentityTransition).not.toHaveBeenCalled();
        expect(document.getElementById('root')).not.toBeNull();
    });

    it('mounts app-shell before the full application chunk resolves', async () => {
        mocks.appImportPending = true;
        mocks.appImportPromise = new Promise<{ App: () => null }>((resolve) => {
            mocks.appImportRelease = resolve;
        });
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => resolve());
        });

        const mainImport = import('../main');
        await rendered;
        await mainImport;

        expectFirstPaintRendered();
        expect(mocks.render).toHaveBeenCalledOnce();
        expect(mocks.bootstrap).toHaveBeenCalledOnce();
    });

    it('fails identity-transition configuration closed when bootstrap import rejects', async () => {
        const failure = new Error('bootstrap chunk failed');
        mocks.bootstrapFailure = failure;
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => resolve());
        });

        await import('../main');
        await rendered;
        expectFirstPaintRendered();
        await vi.waitFor(() => {
            expect(mocks.failIdentityTransition).toHaveBeenCalledOnce();
        });
        const [reason] = mocks.failIdentityTransition.mock.calls[0] as [Error];
        expect(reason.cause).toBe(failure);
    });

    it('registers AppShell mount buses before first paint while bootstrap is pending', async () => {
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => {
                expectMountBusesBoundBeforeRender();
                resolve();
            });
        });

        await import('../main');
        await rendered;

        const { onZoomToFit } = await import('#/modules/WorkspaceShell/useCases');
        expect(() => onZoomToFit(() => undefined)).not.toThrow();

        const onNotification = mocks.onNotification;
        if (!onNotification) {
            throw new Error('onNotification was not loaded for this test');
        }
        expect(() => onNotification(() => undefined)).not.toThrow();
    });
});
