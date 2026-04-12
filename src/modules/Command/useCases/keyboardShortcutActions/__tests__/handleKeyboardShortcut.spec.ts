import { describe, it, expect, vi } from 'vitest';
import { handleKeydown, type KeyDescriptor } from '../handleKeyboardShortcut/handleKeydown';
import { handleKeyup } from '../handleKeyboardShortcut/handleKeyup';
import { eventBus } from '#/app/registerDependencies';

vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
        emit: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: vi.fn(),
    toggleMetronome: vi.fn(),
    seekPlayhead: vi.fn(),
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

vi.mock('#/modules/Workspace/stores', () => ({
    workspaceStore: { value: { selectedClipIds: [], selectedClipId: null } },
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    cycleAutomationVisibility: vi.fn(),
    toggleCommandPalette: vi.fn(),
    selectAllClips: vi.fn(),
    clearClipSelection: vi.fn(),
    toggleWorkspaceMode: vi.fn(),
    TOOL_SHORTCUTS: {},
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { selectedTrackId: null } },
    zoomTimeline: vi.fn(),
}));

vi.mock('../../selectionHelpers/getAllClipIds', () => ({ getAllClipIds: vi.fn() }));
vi.mock('../../selectionHelpers/getLastClipEndBeat', () => ({ getLastClipEndBeat: vi.fn() }));
vi.mock('../../selectionHelpers/goToNextMarker', () => ({ goToNextMarker: vi.fn() }));
vi.mock('../../selectionHelpers/goToPreviousMarker', () => ({ goToPreviousMarker: vi.fn() }));

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
