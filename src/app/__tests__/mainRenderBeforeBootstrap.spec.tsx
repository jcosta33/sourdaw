import { beforeEach, describe, expect, it, vi } from 'vitest';

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
        bootstrap: vi.fn(),
        bootstrapFailure: null as Error | null,
        failIdentityTransition: vi.fn(),
        identity,
        mountBrowserDisplayScaleHost: vi.fn(),
        onNotification: null as null | typeof OnNotification,
        render: vi.fn(),
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

vi.mock('../App', () => ({
    App: function App() {
        return null;
    },
}));

vi.mock('react-dom/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom/client')>();
    return {
        createRoot: (container: Parameters<typeof actual.createRoot>[0]) => {
            const root = actual.createRoot(container);
            return {
                render: (element: Parameters<typeof root.render>[0]) => {
                    mocks.render(element);
                    root.render(element);
                },
            };
        },
    };
});

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
        mocks.identity.reset();
        mocks.onNotification = null;
        Reflect.deleteProperty(window, 'sourdaw');
        window.name = '';
        document.body.innerHTML = '<div id="root"></div>';
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
