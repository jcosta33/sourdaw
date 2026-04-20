import { describe, it, expect, vi } from 'vitest';

import { eventBus } from '#/app/registerDependencies';

import { handleKeydown, type KeyDescriptor } from '../handleKeyboardShortcut/handleKeydown';
import { handleKeyup } from '../handleKeyboardShortcut/handleKeyup';

vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
        emit: vi.fn(),
        on: vi.fn(() => () => undefined),
    },
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        setWriters: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        stopPlayback: vi.fn(),
        toggleMetronome: vi.fn(),
        seekPlayhead: vi.fn(),
    };
});

vi.mock('../trackShortcuts/clearSolos', () => ({ clearSolos: vi.fn() }));
vi.mock('../trackShortcuts/addTrack', () => ({ addTrack: vi.fn() }));
vi.mock('../trackShortcuts/duplicateTrack', () => ({ duplicateTrack: vi.fn() }));
vi.mock('../trackShortcuts/duplicateClip', () => ({ duplicateClip: vi.fn() }));
vi.mock('../trackShortcuts/duplicateClipToNextBar', () => ({ duplicateClipToNextBar: vi.fn() }));
vi.mock('../trackShortcuts/zoomTracksVertical', () => ({ zoomTracksVertical: vi.fn() }));

vi.mock('../workspaceShortcuts/setEditingTool', () => ({ setEditingTool: vi.fn() }));
vi.mock('../workspaceShortcuts/zoomToFit', () => ({ zoomToFit: vi.fn() }));
vi.mock('../workspaceShortcuts/zoomToSelection', () => ({ zoomToSelection: vi.fn() }));

vi.mock('#/modules/Workspace/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Workspace/stores')>();
    return {
        ...actual,
        workspaceStore: { value: { selectedClipIds: [], selectedClipId: null } },
        toolSwapStore: { value: null, set: vi.fn() },
    };
});

vi.mock('#/modules/Workspace/useCases', () => ({
    cycleAutomationVisibility: vi.fn(),
    toggleCommandPalette: vi.fn(),
    selectAllClips: vi.fn(),
    clearClipSelection: vi.fn(),
    toggleWorkspaceMode: vi.fn(),
    setMarqueeSelection: vi.fn(),
    setEditingTool: vi.fn(),
    showAutomationPanel: vi.fn(),
    toggleMixer: vi.fn(),
    toggleTrackList: vi.fn(),
    toggleVirtualKeyboard: vi.fn(),
    openExportDialog: vi.fn(),
    openPreferencesDialog: vi.fn(),
    TOOL_SHORTCUTS: {},
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: { value: { selectedTrackId: null, tracks: [] } },
    };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        addClip: vi.fn(),
        removeClip: vi.fn(),
        deleteTimeRange: vi.fn(),
    };
});

vi.mock('../../undoRedo', () => ({
    undo: vi.fn(),
    redo: vi.fn(),
}));

vi.mock('../../pushUndoEntry', () => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('../../../stores/shortcutStore', () => ({
    shortcutStore: { value: { definitions: [], customMappings: {} } },
}));

vi.mock('../../selectionHelpers/getAllClipIds', () => ({ getAllClipIds: vi.fn() }));
vi.mock('../../selectionHelpers/getLastClipEndBeat', () => ({ getLastClipEndBeat: vi.fn() }));
vi.mock('../../selectionHelpers/goToNextMarker', () => ({ goToNextMarker: vi.fn() }));
vi.mock('../../selectionHelpers/goToPreviousMarker', () => ({ goToPreviousMarker: vi.fn() }));

vi.mock('../../executeAppAction', () => ({ executeAppAction: vi.fn() }));

describe('handleKeyboardShortcut', () => {
    it('should emit voice.toggle on keyup for v', () => {
        handleKeyup('v');

        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: false });
    });

    it('should emit voice.toggle on keydown for v when not in an input', () => {
        const desc: KeyDescriptor = {
            key: 'v',
            mod: false,
            shift: false,
            alt: false,
            repeat: false,
            isInput: false,
        };

        const prevent = handleKeydown(desc);

        expect(prevent).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: true });
    });
});
