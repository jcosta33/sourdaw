import { beforeEach, describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { handleKeydown, type KeyDescriptor } from '../handleKeyboardShortcut/handleKeydown';
import { handleKeyup } from '../handleKeyboardShortcut/handleKeyup';

const eventBus = {
    emit: vi.fn(),
    on: vi.fn(() => () => undefined),
};

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: vi.fn(),
    seekPlayhead: vi.fn(),
    setLoopRegion: vi.fn(),
    stopAllSlots: vi.fn(),
    triggerPad: vi.fn(),
}));

vi.mock('../trackShortcuts/clearSolos', () => ({ clearSolos: vi.fn() }));
vi.mock('../trackShortcuts/addTrack', () => ({ addTrack: vi.fn() }));
vi.mock('../trackShortcuts/duplicateTrack', () => ({ duplicateTrack: vi.fn() }));
vi.mock('../trackShortcuts/duplicateClip', () => ({ duplicateClip: vi.fn() }));
vi.mock('../trackShortcuts/duplicateClipToNextBar', () => ({ duplicateClipToNextBar: vi.fn() }));
vi.mock('../trackShortcuts/zoomTracksVertical', () => ({ zoomTracksVertical: vi.fn() }));

vi.mock('../workspaceShortcuts/setEditingTool', () => ({ setEditingTool: vi.fn() }));
vi.mock('../workspaceShortcuts/zoomToFit', () => ({ zoomToFit: vi.fn() }));
vi.mock('../workspaceShortcuts/zoomToSelection', () => ({ zoomToSelection: vi.fn() }));

vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/WorkspaceShell/stores')>();
    return {
        ...actual,
        workspaceStore: { value: { selectedClipIds: [], selectedClipId: null } },
        toolSwapStore: { value: null, set: vi.fn() },
    };
});

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    cycleAutomationVisibility: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleWorkspaceMode: vi.fn(),
    setEditingTool: vi.fn(),
    startToolSwap: vi.fn(),
    finishToolSwap: vi.fn(),
    showAutomationPanel: vi.fn(),
    toggleMixer: vi.fn(),
    toggleTrackList: vi.fn(),
    toggleVirtualKeyboard: vi.fn(),
    openExportDialog: vi.fn(),
    openPreferencesDialog: vi.fn(),
    TOOL_SHORTCUTS: {},
}));

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

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    redo: vi.fn(),
    undo: vi.fn(),
    pushUndoEntry: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('../../../stores/shortcutStore', () => ({
    shortcutStore: { value: { definitions: [], customMappings: {} } },
}));

vi.mock('../../selectionHelpers/getAllClipIds', () => ({ getAllClipIds: vi.fn() }));
vi.mock('../../selectionHelpers/getLastClipEndBeat', () => ({ getLastClipEndBeat: vi.fn() }));
vi.mock('../../selectionHelpers/goToNextMarker', () => ({ goToNextMarker: vi.fn() }));
vi.mock('../../selectionHelpers/goToPreviousMarker', () => ({ goToPreviousMarker: vi.fn() }));

describe('handleKeyboardShortcut', () => {
    beforeEach(() => {
        injectDependencies(handleKeydown, { eventBus });
        injectDependencies(handleKeyup, { eventBus });
        vi.clearAllMocks();
    });

    it('does not synthesize voice admission on keyup for v', () => {
        handleKeyup('v');

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('does not synthesize voice admission on keydown for v', () => {
        const desc: KeyDescriptor = {
            key: 'v',
            mod: false,
            shift: false,
            alt: false,
            repeat: false,
            isInput: false,
        };

        const prevent = handleKeydown(desc);

        expect(prevent).toBe(false);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});
