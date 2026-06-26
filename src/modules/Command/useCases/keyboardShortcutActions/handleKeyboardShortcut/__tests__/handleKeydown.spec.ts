import { describe, it, expect, vi, beforeEach } from 'vitest';

import { eventBus } from '#/app/registerDependencies';
import { seekPlayhead } from '#/modules/Transport/useCases';

import { handleKeydown, type KeyDescriptor } from '../handleKeydown';

const { getLastClipEndBeatMock, goToNextMarkerMock, goToPreviousMarkerMock } = vi.hoisted(() => ({
    getLastClipEndBeatMock: vi.fn(() => 42),
    goToNextMarkerMock: vi.fn(),
    goToPreviousMarkerMock: vi.fn(),
}));

vi.mock('#/app/registerDependencies', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(() => () => undefined) },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { selectedTrackId: null, tracks: [] } },
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
}));

vi.mock('#/modules/Transport/stores', () => ({
    loopStationStore: { value: { armed: false } },
}));

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: vi.fn(),
    seekPlayhead: vi.fn(),
    setLoopRegion: vi.fn(),
    stopAllSlots: vi.fn(),
    triggerPad: vi.fn(),
}));

vi.mock('#/modules/Workspace/stores', () => ({
    workspaceStore: { value: { selectedClipIds: [], selectedClipId: null } },
    toolSwapStore: { value: null, set: vi.fn() },
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    clearClipSelection: vi.fn(),
    cycleAutomationVisibility: vi.fn(),
    openExportDialog: vi.fn(),
    openPreferencesDialog: vi.fn(),
    selectAllClips: vi.fn(),
    selectClipWithFocus: vi.fn(),
    setEditingTool: vi.fn(),
    setMarqueeSelection: vi.fn(),
    showAutomationPanel: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleMixer: vi.fn(),
    toggleTrackList: vi.fn(),
    toggleVirtualKeyboard: vi.fn(),
    toggleWorkspaceMode: vi.fn(),
    TOOL_SHORTCUTS: {},
}));

vi.mock('../../../../stores/shortcutStore', () => ({
    parseLoopStationPadCallbackId: vi.fn(() => null),
    shortcutStore: { value: { definitions: [], customMappings: {} } },
}));

vi.mock('../../../executeAppAction', () => ({ executeAppAction: vi.fn() }));
vi.mock('../../../pushUndoEntry', () => ({ pushUndoEntry: vi.fn() }));
vi.mock('../../../selectionHelpers/getAllClipIds', () => ({ getAllClipIds: vi.fn(() => []) }));
vi.mock('../../../selectionHelpers/getLastClipEndBeat', () => ({ getLastClipEndBeat: getLastClipEndBeatMock }));
vi.mock('../../../selectionHelpers/goToNextMarker', () => ({ goToNextMarker: goToNextMarkerMock }));
vi.mock('../../../selectionHelpers/goToPreviousMarker', () => ({ goToPreviousMarker: goToPreviousMarkerMock }));
vi.mock('../../../undoRedo', () => ({ undo: vi.fn(), redo: vi.fn() }));
vi.mock('../../clipShortcuts/duplicateSelectedClipsForward', () => ({ duplicateSelectedClipsForward: vi.fn() }));
vi.mock('../../trackShortcuts/duplicateTrack', () => ({ duplicateTrack: vi.fn() }));

function descriptor(overrides: Partial<KeyDescriptor> & { key: string }): KeyDescriptor {
    return { mod: false, shift: false, alt: false, repeat: false, isInput: false, ...overrides };
}

describe('handleKeydown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
