import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { seekPlayhead } from '#/modules/Transport/useCases';
import { setEditingTool, startToolSwap } from '#/modules/WorkspaceShell/useCases';

import { handleKeydown, type KeyDescriptor } from '../handleKeydown';

const {
    getLastClipEndBeatMock,
    goToNextMarkerMock,
    goToPreviousMarkerMock,
    loggerMock,
    shortcutStoreMock,
    stopPlaybackMock,
} = vi.hoisted(() => ({
    getLastClipEndBeatMock: vi.fn(() => 42),
    goToNextMarkerMock: vi.fn(),
    goToPreviousMarkerMock: vi.fn(),
    loggerMock: { error: vi.fn() },
    shortcutStoreMock: {
        value: {
            definitions: [] as Array<{
                id: string;
                defaultKeys: string[];
                action: { type: 'callback'; id: string };
            }>,
            customMappings: {} as Record<string, string[]>,
        },
    },
    stopPlaybackMock: vi.fn(() => Promise.resolve()),
}));

const eventBus = { emit: vi.fn(), on: vi.fn(() => () => undefined) };

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { selectedTrackId: null, tracks: [] } },
    clipSelectionStore: { value: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null } },
    zoomTimeline: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    acceptGhostClip: vi.fn(),
    dismissGhostClip: vi.fn(),
    deleteTimeRange: vi.fn(),
    insertTime: vi.fn(),
    duplicateTimeRange: vi.fn(),
    removeClip: vi.fn(),
    addClip: vi.fn(),
    clearClipSelection: vi.fn(),
    selectAllClips: vi.fn(),
    selectClipWithFocus: vi.fn(),
    setMarqueeSelection: vi.fn(),
}));

vi.mock('#/modules/SessionLauncher/stores', () => ({
    loopStationStore: { value: { armed: false } },
}));

vi.mock('#/modules/SessionLauncher/useCases', () => ({
    stopAllSlots: vi.fn(),
    triggerPad: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: stopPlaybackMock,
    seekPlayhead: vi.fn(),
    setLoopRegion: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: { value: { activeTool: 'select', selectedClipIds: [], selectedClipId: null } },
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    cycleAutomationVisibility: vi.fn(),
    openExportDialog: vi.fn(),
    openPreferencesDialog: vi.fn(),
    setEditingTool: vi.fn(),
    showAutomationPanel: vi.fn(),
    startToolSwap: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleMixer: vi.fn(),
    toggleTrackList: vi.fn(),
    toggleVirtualKeyboard: vi.fn(),
    toggleWorkspaceMode: vi.fn(),
    TOOL_SHORTCUTS: { d: 'draw' },
}));

vi.mock('../../../../stores/shortcutStore', () => ({
    parseLoopStationPadCallbackId: vi.fn(() => null),
    shortcutStore: shortcutStoreMock,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: loggerMock }));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual: typeof import('#/modules/Command/useCases') = await importOriginal();
    const commitUndo = vi.fn();
    return {
        ...actual,
        executeAppAction: vi.fn(),
        pushUndoEntry: commitUndo,
        runLegacyCommandMutation: (mutation: (publishUndo: typeof commitUndo) => unknown) =>
            Promise.resolve(mutation(commitUndo)),
        redo: vi.fn(),
        undo: vi.fn(),
    };
});
vi.mock('../../../selectionHelpers/getAllClipIds', () => ({ getAllClipIds: vi.fn(() => []) }));
vi.mock('../../../selectionHelpers/getLastClipEndBeat', () => ({ getLastClipEndBeat: getLastClipEndBeatMock }));
vi.mock('../../../selectionHelpers/goToNextMarker', () => ({ goToNextMarker: goToNextMarkerMock }));
vi.mock('../../../selectionHelpers/goToPreviousMarker', () => ({ goToPreviousMarker: goToPreviousMarkerMock }));
vi.mock('../../clipShortcuts/duplicateSelectedClipsForward', () => ({ duplicateSelectedClipsForward: vi.fn() }));
vi.mock('../../trackShortcuts/duplicateTrack', () => ({ duplicateTrack: vi.fn() }));

function descriptor(overrides: Partial<KeyDescriptor> & { key: string }): KeyDescriptor {
    return { mod: false, shift: false, alt: false, repeat: false, isInput: false, ...overrides };
}

describe('handleKeydown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        shortcutStoreMock.value.definitions = [];
        shortcutStoreMock.value.customMappings = {};
        injectDependencies(handleKeydown, { eventBus });
    });

    it('emits voice.toggle active for a bare v and asks the caller to preventDefault', () => {
        const prevent = handleKeydown(descriptor({ key: 'v' }));

        expect(prevent).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: true });
    });

    it('does not toggle voice when v is pressed inside an input field', () => {
        const prevent = handleKeydown(descriptor({ key: 'v', isInput: true }));

        expect(prevent).toBe(false);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('seeks the playhead to the start on Home', () => {
        const prevent = handleKeydown(descriptor({ key: 'Home' }));

        expect(prevent).toBe(true);
        expect(seekPlayhead).toHaveBeenCalledWith(0);
    });

    it('seeks the playhead to the last clip end on End', () => {
        const prevent = handleKeydown(descriptor({ key: 'End' }));

        expect(prevent).toBe(true);
        expect(getLastClipEndBeatMock).toHaveBeenCalled();
        expect(seekPlayhead).toHaveBeenCalledWith(42);
    });

    it('scrolls to the playhead on L without preventing default', () => {
        const prevent = handleKeydown(descriptor({ key: 'L' }));

        expect(prevent).toBe(false);
        expect(eventBus.emit).toHaveBeenCalledWith('zoom.scrollToPlayhead', undefined);
    });

    it('navigates to the next marker on ] and does not prevent default', () => {
        const prevent = handleKeydown(descriptor({ key: ']' }));

        expect(prevent).toBe(false);
        expect(goToNextMarkerMock).toHaveBeenCalledTimes(1);
    });

    it('navigates to the previous marker on [', () => {
        handleKeydown(descriptor({ key: '[' }));

        expect(goToPreviousMarkerMock).toHaveBeenCalledTimes(1);
    });

    it('blocks plain keys while typing in an input field', () => {
        const prevent = handleKeydown(descriptor({ key: 'Home', isInput: true }));

        expect(prevent).toBe(false);
        expect(seekPlayhead).not.toHaveBeenCalled();
    });

    it('asks Workspace to start a held tool swap before selecting the requested tool', () => {
        const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(1234);

        const prevent = handleKeydown(descriptor({ key: 'd' }));

        expect(prevent).toBe(false);
        expect(startToolSwap).toHaveBeenCalledWith({
            key: 'd',
            timestamp: 1234,
            tool: 'draw',
        });
        expect(setEditingTool).toHaveBeenCalledWith('draw');
        const [startOrder] = vi.mocked(startToolSwap).mock.invocationCallOrder;
        const [selectOrder] = vi.mocked(setEditingTool).mock.invocationCallOrder;
        if (startOrder === undefined || selectOrder === undefined) {
            throw new Error('expected tool-swap and tool-selection calls to be recorded');
        }
        expect(startOrder).toBeLessThan(selectOrder);

        performanceNow.mockRestore();
    });

    it('reports a rejected stopPlayback promise from the shortcut', async () => {
        const flushError = new Error('recording flush failed');
        stopPlaybackMock.mockRejectedValueOnce(flushError);
        shortcutStoreMock.value.definitions = [
            {
                id: 'transport.stopPlayback',
                defaultKeys: ['Escape'],
                action: { type: 'callback', id: 'stopPlayback' },
            },
        ];

        const prevent = handleKeydown(descriptor({ key: 'Escape' }));

        expect(prevent).toBe(false);
        await vi.waitFor(() => expect(loggerMock.error).toHaveBeenCalledTimes(1));

        expect(loggerMock.error).toHaveBeenCalledWith(expect.any(Error));
        expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Keyboard shortcut stop request failed',
                cause: flushError,
            })
        );
    });
});
