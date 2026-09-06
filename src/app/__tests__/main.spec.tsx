import { isValidElement } from 'react';

import { render } from '@testing-library/react';
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
    setCommandEventBus: vi.fn(),
    setNotificationEventBus: vi.fn(),
    setVoiceToggleEventBus: vi.fn(),
    setWebMidiRuntimeEventBus: vi.fn(),
    setWorkspaceEventBus: vi.fn(),
}));

function observeNextRender(): Promise<void> {
    return new Promise((resolve) => {
        mocks.render.mockImplementationOnce(() => resolve());
    });
}

function expectFirstPaintBusesRegisteredBeforeRender(): void {
    expect(mocks.setWorkspaceEventBus).toHaveBeenCalledOnce();
    expect(mocks.setVoiceToggleEventBus).toHaveBeenCalledOnce();
    expect(mocks.setNotificationEventBus).toHaveBeenCalledOnce();
    expect(mocks.setWebMidiRuntimeEventBus).toHaveBeenCalledOnce();
    expect(mocks.setCommandEventBus).toHaveBeenCalledOnce();
    const renderOrder = mocks.render.mock.invocationCallOrder[0];
    expect(renderOrder).toBeDefined();
    if (renderOrder === undefined) {
        throw new Error('Application render did not run');
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
}

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
    setWorkspaceEventBus: mocks.setWorkspaceEventBus,
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    setVoiceToggleEventBus: mocks.setVoiceToggleEventBus,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    setWebMidiRuntimeEventBus: mocks.setWebMidiRuntimeEventBus,
    adaptGrooveTemplateForConsumer: vi.fn(),
    addChordEvent: vi.fn(),
    appendMidiNotes: vi.fn(),
    arpeggiate: vi.fn(),
    assignGrooveTemplate: vi.fn(),
    canPrepareMidiClipGlueState: vi.fn(),
    createGrooveTemplate: vi.fn(),
    downloadMidiFile: vi.fn(),
    duplicateClipNotes: vi.fn(),
    duplicateMidiClipData: vi.fn(),
    getCanonicalGrooveTemplateKey: vi.fn(),
    getChordAtBeat: vi.fn(),
    getGrooveTemplate: vi.fn(),
    getMidiInputTrack: vi.fn(),
    getMidiInputTrackOwnerId: vi.fn(),
    getMidiInputTrackRevision: vi.fn(),
    getMidiStoreState: vi.fn(),
    getScopedGrooveAssignment: vi.fn(),
    getScopedGrooveConsumerId: vi.fn(),
    getStraightGrooveTemplateId: vi.fn(),
    hasActiveStepRecordingDependency: vi.fn(),
    hydrateGrooveTemplates: vi.fn(),
    hydrateMidiProjectState: vi.fn(),
    mergeImportedMidiClipNotes: vi.fn(),
    midiClipGlueStateMatches: vi.fn(),
    midiClipSplitStateMatches: vi.fn(),
    migrateAbsoluteMidiNotes: vi.fn(),
    panicLiveNotes: vi.fn(),
    prepareMidiClipGlueState: vi.fn(),
    prepareMidiClipSplit: vi.fn(),
    projectClipMidiEvents: vi.fn(),
    projectCommittedGroove: vi.fn(),
    projectDrumPreviewCandidateNotes: vi.fn(),
    projectMidiNotesByClipIdThroughRestores: vi.fn(() => ({})),
    readLegacyChordTrackMigration: vi.fn(),
    readMidiFile: vi.fn(),
    removeMidiClipData: vi.fn(),
    replaceChordTrackState: vi.fn(),
    resetMidiState: vi.fn(),
    resetMidiStoreForProject: vi.fn(),
    resolveMidiNoteArticulationId: vi.fn(),
    restoreGrooveAssignment: vi.fn(),
    restoreMidiClipData: vi.fn(),
    restoreMidiClipGlueState: vi.fn(),
    restoreMidiClipNotes: vi.fn(),
    restoreMidiClipSplitState: vi.fn(),
    serializeMidiStateForClips: vi.fn(),
    setMidiInputTrack: vi.fn(),
    setMidiStoreState: vi.fn(),
    setNotesForClip: vi.fn(),
    shouldPlayMidiEvent: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
    transposeForChordTrack: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    setCommandEventBus: mocks.setCommandEventBus,
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    clearUndoHistory: vi.fn(),
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
    executeUserAppAction: vi.fn(),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    reconcileSessionUndoForProject: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

vi.mock('#/utils/Notification/notificationEventBus', () => ({
    NotificationEventBus: class NotificationEventBus {},
    setNotificationEventBus: mocks.setNotificationEventBus,
}));

vi.mock('../App', () => ({
    __esModule: true,
    then(onFulfilled: (value: { App: () => null }) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve({ App: () => null }).then(onFulfilled, onRejected);
    },
}));

vi.mock('react-dom/client', () => ({
    createRoot: () => ({ render: mocks.render }),
}));

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
    const probe = document.createElement('div');
    render(firstRender, { container: probe });
    expect(probe.querySelector('[data-testid="app-shell"]')).not.toBeNull();
}

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
        expect(mocks.setWorkspaceEventBus).not.toHaveBeenCalled();
        expect(mocks.setVoiceToggleEventBus).not.toHaveBeenCalled();
        expect(mocks.setNotificationEventBus).not.toHaveBeenCalled();
        expect(mocks.setWebMidiRuntimeEventBus).not.toHaveBeenCalled();
        expect(mocks.setCommandEventBus).not.toHaveBeenCalled();
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
        const rendered = observeNextRender();

        const mainImport = import('../main');

        await vi.waitFor(() => expect(mocks.resetDisplayScaleForStartup).toHaveBeenCalledOnce());
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
        if (finishReset === undefined) {
            throw new Error('Display scale reset did not expose its completion');
        }
        finishReset();
        await mainImport;
        await rendered;

        expect(mocks.bootstrap).toHaveBeenCalledOnce();
        expect(mocks.render).toHaveBeenCalled();
        expectFirstPaintRendered();
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
        expectFirstPaintBusesRegisteredBeforeRender();
    });

    it('resets the browser host before importing and rendering a child application', async () => {
        mocks.resolveAppComposition.mockReturnValue('application');
        mocks.resetBrowserDisplayScaleForChildStartup.mockImplementationOnce(() => {
            expect(mocks.bootstrap).not.toHaveBeenCalled();
            expect(mocks.render).not.toHaveBeenCalled();
        });
        const rendered = observeNextRender();

        await import('../main');
        await rendered;

        expect(mocks.render).toHaveBeenCalled();
        expectFirstPaintRendered();
        expect(mocks.resetBrowserDisplayScaleForChildStartup).toHaveBeenCalledOnce();
        expect(mocks.resetDisplayScaleForStartup).not.toHaveBeenCalled();
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
        expectFirstPaintBusesRegisteredBeforeRender();
    });

    it('renders only the fatal startup surface when a desktop document has no bridge', async () => {
        mocks.resolveAppComposition.mockReturnValue('desktop-startup-error');
        const rendered = observeNextRender();

        await import('../main');
        await rendered;

        expect(mocks.render).toHaveBeenCalledOnce();
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
        expect(mocks.setWorkspaceEventBus).not.toHaveBeenCalled();
        expect(mocks.setVoiceToggleEventBus).not.toHaveBeenCalled();
        expect(mocks.setNotificationEventBus).not.toHaveBeenCalled();
        expect(mocks.setWebMidiRuntimeEventBus).not.toHaveBeenCalled();
        expect(mocks.setCommandEventBus).not.toHaveBeenCalled();
    });
});
