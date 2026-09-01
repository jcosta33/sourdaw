import { beforeEach, describe, expect, it, vi } from 'vitest';

const INIT_ERROR_TOAST = 'App failed to load — please reload the page.';

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
        render: vi.fn(),
        resetBrowserDisplayScaleForChildStartup: vi.fn(),
        resetDisplayScaleForStartup: vi.fn(),
        resolveAppComposition: vi.fn(),
        toasts: [] as Array<{ message: string; level: string }>,
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

vi.mock('#/modules/WorkspaceShell/useCases', async () => {
    const { setWorkspaceEventBus } = await import('../../modules/WorkspaceShell/useCases/workspaceEventBus');
    const { onZoomToFit } =
        await import('../../modules/WorkspaceShell/useCases/togglePanel/zoomOperations/onZoomToFit');
    return {
        setWorkspaceEventBus,
        onZoomToFit,
        resetDisplayScaleForStartup: mocks.resetDisplayScaleForStartup,
    };
});

vi.mock('#/modules/AiRuntime/useCases', async () => {
    const { setVoiceToggleEventBus } = await import('../../modules/AiRuntime/useCases/voiceToggle/voiceToggleEventBus');
    const { onVoiceToggle } = await import('../../modules/AiRuntime/useCases/voiceToggle/onVoiceToggle');
    return {
        setVoiceToggleEventBus,
        onVoiceToggle,
    };
});

vi.mock('#/modules/Project/useCases', () => ({
    failProjectIdentityTransitionDependencies: (reason: unknown) => {
        mocks.failIdentityTransition(reason);
        mocks.identity.fail(reason);
    },
    whenProjectIdentityTransitionDependenciesConfigured: () => mocks.identity.ready,
    loadProject: vi.fn(),
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
    setWebMidiRuntimeEventBus: vi.fn(),
}));

vi.mock('#/modules/SampleLibrary/useCases', () => ({
    restoreLibrary: vi.fn().mockResolvedValue(undefined),
    seedFactoryLibrary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/Synth/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Synth/useCases')>()),
    registerProSynthInstruments: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: vi.fn(),
    getTransportState: vi.fn(() => null),
    syncTransportMapsToNativeSession: vi.fn(() => vi.fn()),
}));

vi.mock('#/utils/Notification/notifyUser', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/utils/Notification/notifyUser')>();
    return {
        notifyUser: (message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
            mocks.toasts.push({ message, level });
            actual.notifyUser(message, level);
        },
    };
});

vi.mock('../App', async () => {
    const { useAppInitialization } = await import('#/modules/WorkspaceShell/presentations/hooks/useAppInitialization');
    return {
        App: function App() {
            useAppInitialization();
            return null;
        },
    };
});

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

describe('app main first paint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        mocks.bootstrapFailure = null;
        mocks.identity.reset();
        mocks.toasts.length = 0;
        Reflect.deleteProperty(window, 'sourdaw');
        window.name = '';
        document.body.innerHTML = '<div id="root"></div>';
        mocks.resolveAppComposition.mockReturnValue('application');
        try {
            localStorage.setItem('wd:first-load-hint-shown', '1');
        } catch {
            // ignore
        }
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
            expect(mocks.toasts).toContainEqual({ message: INIT_ERROR_TOAST, level: 'error' });
        });
        expect(mocks.failIdentityTransition).toHaveBeenCalledOnce();
    });

    it('registers AppShell mount buses before first paint while bootstrap is pending', async () => {
        const rendered = new Promise<void>((resolve) => {
            mocks.render.mockImplementationOnce(() => resolve());
        });

        await import('../main');
        await rendered;

        const { onZoomToFit } = await import('#/modules/WorkspaceShell/useCases');
        expect(() => onZoomToFit(() => undefined)).not.toThrow();

        const { onVoiceToggle } = await import('#/modules/AiRuntime/useCases');
        expect(() => onVoiceToggle(() => undefined)).not.toThrow();
    });
});
