import { isValidElement } from 'react';

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    App: function MockApp() {
        return null;
    },
    bootstrap: vi.fn(),
    clearInheritedRetrospectiveCaptureArm: vi.fn(),
    desktopStartupError: vi.fn(() => null),
    mountBrowserDisplayScaleHost: vi.fn(),
    reloadApplication: vi.fn(),
    loadApp: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    render: vi.fn<(element: unknown) => void>(),
    resetBrowserDisplayScaleForChildStartup: vi.fn(),
    resetDisplayScaleForStartup: vi.fn(),
    resolveAppComposition: vi.fn(),
    setCommandEventBus: vi.fn(),
    setNotificationEventBus: vi.fn(),
    setVoiceToggleEventBus: vi.fn(),
    isExactMidiClipDataActionSnapshot:
        vi.fn<typeof import('#/modules/MIDI/useCases').isExactMidiClipDataActionSnapshot>(),
    setWebMidiRuntimeEventBus: vi.fn(),
    setWorkspaceEventBus: vi.fn(),
}));

function deferredGate(): { promise: Promise<void>; release: () => void } {
    let resolveGate: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
        resolveGate = resolve;
    });
    return {
        promise,
        release: () => resolveGate?.(),
    };
}

let pendingStartupCompletion: Promise<void> | undefined;
let releaseDesktopReset: (() => void) | undefined;
let releaseAppImport: (() => void) | undefined;
let restoreAppRender: (() => void) | undefined;
let appRenderObserved = false;
let startupSettled = false;
let appImportGateReleasedByCleanup = false;
let requireStartupCleanupBeforeNextCase = false;

function observeFinalAppRender(): void {
    const previousImplementation = mocks.render.getMockImplementation();
    let resolveStartupCompletion: (() => void) | undefined;
    pendingStartupCompletion = new Promise<void>((resolve) => {
        resolveStartupCompletion = resolve;
    });
    appRenderObserved = false;
    startupSettled = false;
    mocks.render.mockImplementation((element) => {
        previousImplementation?.(element);
        if (isValidElement(element) && element.type === mocks.App) {
            appRenderObserved = true;
            resolveStartupCompletion?.();
        }
    });
    restoreAppRender = () => {
        mocks.render.mockImplementation(previousImplementation ?? (() => undefined));
        restoreAppRender = undefined;
    };
}

async function settlePendingStartup(): Promise<void> {
    releaseDesktopReset?.();
    releaseAppImport?.();
    if (pendingStartupCompletion) {
        await pendingStartupCompletion;
        pendingStartupCompletion = undefined;
        startupSettled = true;
        restoreAppRender?.();
    }
    releaseDesktopReset = undefined;
    releaseAppImport = undefined;
}

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

vi.mock('#/styles/main.css', () => ({}));

vi.mock('../browserDisplayScaleHost', () => ({
    mountBrowserDisplayScaleHost: mocks.mountBrowserDisplayScaleHost,
    resetBrowserDisplayScaleForChildStartup: mocks.resetBrowserDisplayScaleForChildStartup,
}));

vi.mock('../DesktopStartupError', () => ({ DesktopStartupError: mocks.desktopStartupError }));

vi.mock('../resolveAppComposition', () => ({
    resolveAppComposition: mocks.resolveAppComposition,
}));

vi.mock('../clearInheritedRetrospectiveCaptureArm', () => ({
    clearInheritedRetrospectiveCaptureArm: mocks.clearInheritedRetrospectiveCaptureArm,
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
    isExactMidiClipDataActionSnapshot: mocks.isExactMidiClipDataActionSnapshot,
    decodeMidiClipDataSnapshots: vi.fn(() => null),
    setWebMidiRuntimeEventBus: mocks.setWebMidiRuntimeEventBus,
    projectClipControllerEvents: vi.fn(),
    projectChannelBend: vi.fn(),
    projectClipControllerRestore: vi.fn(),
    adaptGrooveTemplateForConsumer: vi.fn(),
    addChordEvent: vi.fn(),
    appendMidiNotes: vi.fn(),
    arpeggiate: vi.fn(),
    assignGrooveTemplate: vi.fn(),
    canPrepareMidiClipGlueState: vi.fn(),
    createGrooveTemplate: vi.fn(),
    downloadMidiFile: vi.fn(),
    commitRecordedControllers: vi.fn(),
    discardRecordedControllers: vi.fn(),
    planRecordedControllers: vi.fn(),
    isOverdubLanding: () => false,
    countSettledOverdubPasses: () => 0,
    waitForOverdubLanding: () => Promise.resolve(),
    duplicateClipNotes: vi.fn(),
    duplicateMidiClipData: vi.fn(),
    getCanonicalGrooveTemplateKey: vi.fn(),
    getChordAtBeat: vi.fn(),
    getGrooveTemplate: vi.fn(),
    getMidiInputTrack: vi.fn(),
    getMidiInputTrackOwnerId: vi.fn(),
    getMidiInputTrackRevision: vi.fn(),
    getMidiStoreState: vi.fn(),
    getNotesForClip: vi.fn(() => []),
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
    prepareMidiClipFanOutState: vi.fn(),
    prepareMidiClipGlueState: vi.fn(),
    prepareMidiClipSplit: vi.fn(),
    projectMidiClipWindow: vi.fn(),
    projectMidiClipPlayback: vi.fn(),
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
    isMidiRowCoordinateCapture: vi.fn<typeof import('#/modules/MIDI/useCases').isMidiRowCoordinateCapture>(),
    prepareClipMidiRowCoordinateShift:
        vi.fn<typeof import('#/modules/MIDI/useCases').prepareClipMidiRowCoordinateShift>(),
    shiftClipMidiNotes: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
    transposeForChordTrack: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    commitRedoInverseCapture: vi.fn(),
    readUndoEntryForInverse: vi.fn<typeof import('#/modules/Command/useCases').readUndoEntryForInverse>(() => null),

    getExecutableAppActionEffect: vi.fn(() => null),
    isAppActionConflictError: vi.fn(() => false),
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
    beforeEach(async () => {
        await settlePendingStartup();
        if (requireStartupCleanupBeforeNextCase) {
            expect(appImportGateReleasedByCleanup).toBe(true);
            expect(appRenderObserved).toBe(true);
            expect(startupSettled).toBe(true);
            requireStartupCleanupBeforeNextCase = false;
        }
        vi.clearAllMocks();
        vi.resetModules();
        mocks.loadApp.mockReset();
        mocks.loadApp.mockImplementation(() => Promise.resolve());
        appImportGateReleasedByCleanup = false;
        appRenderObserved = false;
        startupSettled = false;
        Reflect.deleteProperty(window, 'sourdaw');
        window.name = '';
        document.body.innerHTML = '<div id="root"></div>';
        mocks.resolveAppComposition.mockReturnValue('browser-host');
        vi.doMock('../App', async () => {
            await mocks.loadApp();
            return { App: mocks.App };
        });
    });

    afterEach(async () => {
        releaseDesktopReset?.();
        releaseAppImport?.();
        await settlePendingStartup();
        expect(mocks.isExactMidiClipDataActionSnapshot).not.toHaveBeenCalled();
        vi.unstubAllEnvs();
    });

    it.each([
        { name: 'a development server', dev: true, mode: 'development', expected: true },
        { name: 'an e2e-mode production build', dev: false, mode: 'e2e', expected: true },
        { name: 'a plain production build', dev: false, mode: 'production', expected: false },
    ])('reports isDevelopment for $name as $expected', async ({ dev, mode, expected }) => {
        vi.stubEnv('DEV', dev);
        vi.stubEnv('MODE', mode);

        await import('../main');

        expect(mocks.resolveAppComposition).toHaveBeenCalledWith(expect.objectContaining({ isDevelopment: expected }));
    });

    it('mounts only the browser viewport host in the top-level browser document', async () => {
        await import('../main');

        expect(mocks.resolveAppComposition).toHaveBeenCalledWith({
            hasDesktopBridge: false,
            isDevelopment: import.meta.env.DEV || import.meta.env.MODE === 'e2e',
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
        const resetGate = deferredGate();
        const finishReset = resetGate.release;
        releaseDesktopReset = resetGate.release;
        mocks.resetDisplayScaleForStartup.mockReturnValueOnce(resetGate.promise);
        const rendered = observeNextRender();
        observeFinalAppRender();

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
        expect(mocks.clearInheritedRetrospectiveCaptureArm).toHaveBeenCalledOnce();
        const clearArmCallOrder = mocks.clearInheritedRetrospectiveCaptureArm.mock.invocationCallOrder[0];
        if (clearArmCallOrder === undefined) {
            throw new Error('Desktop startup did not clear an inherited retrospective capture arm');
        }
        expect(clearArmCallOrder).toBeLessThan(renderCallOrder);
        expect(mocks.resetBrowserDisplayScaleForChildStartup).not.toHaveBeenCalled();
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
        expectFirstPaintBusesRegisteredBeforeRender();
    });

    it('settles delayed desktop startup before resetting the next test case', async () => {
        Reflect.set(window, 'sourdaw', {});
        mocks.resolveAppComposition.mockReturnValue('application');
        const resetGate = deferredGate();
        const appImportGate = deferredGate();
        releaseDesktopReset = resetGate.release;
        releaseAppImport = () => {
            appImportGateReleasedByCleanup = true;
            appImportGate.release();
        };
        mocks.resetDisplayScaleForStartup.mockReturnValueOnce(resetGate.promise);
        mocks.loadApp.mockReturnValueOnce(appImportGate.promise);
        const rendered = observeNextRender();
        observeFinalAppRender();

        const mainImport = import('../main');

        await vi.waitFor(() => expect(mocks.resetDisplayScaleForStartup).toHaveBeenCalledOnce());
        resetGate.release();
        await mainImport;
        await rendered;
        await vi.waitFor(() => expect(mocks.loadApp).toHaveBeenCalledOnce());

        expect(appRenderObserved).toBe(false);
        expect(mocks.render.mock.calls.some(([element]) => isValidElement(element) && element.type === mocks.App)).toBe(
            false
        );
        expectFirstPaintRendered();
        expectFirstPaintBusesRegisteredBeforeRender();
        requireStartupCleanupBeforeNextCase = true;
    });

    it('resets the browser host before importing and rendering a child application', async () => {
        mocks.resolveAppComposition.mockReturnValue('application');
        mocks.resetBrowserDisplayScaleForChildStartup.mockImplementationOnce(() => {
            expect(mocks.bootstrap).not.toHaveBeenCalled();
            expect(mocks.render).not.toHaveBeenCalled();
        });
        const rendered = observeNextRender();
        observeFinalAppRender();

        await import('../main');
        await rendered;

        expect(mocks.render).toHaveBeenCalled();
        expectFirstPaintRendered();
        expect(mocks.resetBrowserDisplayScaleForChildStartup).toHaveBeenCalledOnce();
        expect(mocks.resetDisplayScaleForStartup).not.toHaveBeenCalled();
        expect(mocks.clearInheritedRetrospectiveCaptureArm).not.toHaveBeenCalled();
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
        expect(mocks.clearInheritedRetrospectiveCaptureArm).not.toHaveBeenCalled();
        expect(mocks.bootstrap).not.toHaveBeenCalled();
        expect(mocks.mountBrowserDisplayScaleHost).not.toHaveBeenCalled();
        expect(mocks.setWorkspaceEventBus).not.toHaveBeenCalled();
        expect(mocks.setVoiceToggleEventBus).not.toHaveBeenCalled();
        expect(mocks.setNotificationEventBus).not.toHaveBeenCalled();
        expect(mocks.setWebMidiRuntimeEventBus).not.toHaveBeenCalled();
        expect(mocks.setCommandEventBus).not.toHaveBeenCalled();
    });
});
