import { describe, it, expect, vi } from 'vitest';

import { defaultWorkspaceState } from '../../../models/WorkspaceState';
import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';
import { clearClipSelection } from '../panelToggles/clearClipSelection';
import { closeBranchManager } from '../panelToggles/closeBranchManager';
import { closeCollaborationPanel } from '../panelToggles/closeCollaborationPanel';
import { closeCommandPalette } from '../panelToggles/closeCommandPalette';
import { closeScratchPad } from '../panelToggles/closeScratchPad';
import { closeUndoHistory } from '../panelToggles/closeUndoHistory';
import { cycleChannelStripWidth } from '../panelToggles/cycleChannelStripWidth';
import { openInspector } from '../panelToggles/openInspector';
import { openMixer } from '../panelToggles/openMixer';
import { openVirtualKeyboard } from '../panelToggles/openVirtualKeyboard';
import { selectAllClips } from '../panelToggles/selectAllClips';
import { selectClip } from '../panelToggles/selectClip';
import { selectClipWithFocus } from '../panelToggles/selectClipWithFocus';
import { setClipSelection } from '../panelToggles/setClipSelection';
import { setSnapValue } from '../panelToggles/setSnapValue';
import { setSoloMode } from '../panelToggles/setSoloMode';
import { setTrackListWidth } from '../panelToggles/setTrackListWidth';
import { setVirtualKeyboardOctave } from '../panelToggles/setVirtualKeyboardOctave';
import { setVirtualKeyboardVelocity } from '../panelToggles/setVirtualKeyboardVelocity';
import { toggleAutomationPanel } from '../panelToggles/toggleAutomationPanel';
import { toggleBranchManager } from '../panelToggles/toggleBranchManager';
import { toggleChatPanel } from '../panelToggles/toggleChatPanel';
import { toggleClipInSelection } from '../panelToggles/toggleClipInSelection';
import { toggleCollaborationPanel } from '../panelToggles/toggleCollaborationPanel';
import { toggleCommandPalette } from '../panelToggles/toggleCommandPalette';
import { toggleInspector } from '../panelToggles/toggleInspector';
import { toggleMixer } from '../panelToggles/toggleMixer';
import { toggleSidebar } from '../panelToggles/toggleSidebar';
import { toggleTimeDisplayMode } from '../panelToggles/toggleTimeDisplayMode';
import { toggleTrackList } from '../panelToggles/toggleTrackList';
import { toggleUndoHistory } from '../panelToggles/toggleUndoHistory';
import { toggleVirtualKeyboard } from '../panelToggles/toggleVirtualKeyboard';
import { toggleWorkspaceMode } from '../panelToggles/toggleWorkspaceMode';

vi.mock('#/modules/Workspace/repositories/getWorkspaceState', () => ({
    getWorkspaceState: vi.fn(),
}));
vi.mock('#/modules/Workspace/repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: vi.fn(),
}));

describe('panelToggles', () => {
    describe('functions that only call updateWorkspaceState', () => {
        it.each([
            ['openVirtualKeyboard', openVirtualKeyboard, () => openVirtualKeyboard(), { virtualKeyboardOpen: true }],
            [
                'setVirtualKeyboardOctave',
                setVirtualKeyboardOctave,
                () => setVirtualKeyboardOctave(5),
                { virtualKeyboardOctave: 5 },
            ],
            [
                'setVirtualKeyboardVelocity',
                setVirtualKeyboardVelocity,
                () => setVirtualKeyboardVelocity(64),
                { virtualKeyboardVelocity: 64 },
            ],
            [
                'closeCollaborationPanel',
                closeCollaborationPanel,
                () => closeCollaborationPanel(),
                { collaborationPanelOpen: false },
            ],
            ['closeUndoHistory', closeUndoHistory, () => closeUndoHistory(), { undoHistoryOpen: false }],
            ['closeCommandPalette', closeCommandPalette, () => closeCommandPalette(), { commandPaletteOpen: false }],
            ['selectClip', selectClip, () => selectClip('clip-a'), { selectedClipId: 'clip-a' }],
            [
                'selectClipWithFocus',
                selectClipWithFocus,
                () => selectClipWithFocus('clip-b'),
                { selectedClipId: 'clip-b', selectedClipIds: ['clip-b'] },
            ],
            [
                'clearClipSelection',
                clearClipSelection,
                () => clearClipSelection(),
                { selectedClipId: null, selectedClipIds: [] },
            ],
            ['openMixer', openMixer, () => openMixer(), { mixerOpen: true }],
            ['openInspector', openInspector, () => openInspector(), { inspectorOpen: true }],
            ['setTrackListWidth', setTrackListWidth, () => setTrackListWidth(300), { trackListWidth: 300 }],
            ['closeScratchPad', closeScratchPad, () => closeScratchPad(), { scratchPadOpen: false }],
            ['closeBranchManager', closeBranchManager, () => closeBranchManager(), { branchManagerOpen: false }],
            [
                'setClipSelection',
                setClipSelection,
                () => setClipSelection(['c1', 'c2']),
                { selectedClipId: 'c1', selectedClipIds: ['c1', 'c2'] },
            ],
            [
                'selectAllClips',
                selectAllClips,
                () => selectAllClips(() => ['a', 'b']),
                { selectedClipIds: ['a', 'b'], selectedClipId: null },
            ],
        ])('should call updateWorkspaceState for %s', (_label, _subject, invoke, expected) => {
            vi.mocked(updateWorkspaceState).mockClear();
            invoke();
            expect(updateWorkspaceState).toHaveBeenCalledWith(expected);
        });
    });

    describe('functions that read current state', () => {
        function base(): typeof defaultWorkspaceState {
            return { ...defaultWorkspaceState };
        }

        it.each([
            ['setSoloMode', setSoloMode, () => setSoloMode('pfl'), { soloMode: 'pfl' }],
            ['toggleSidebar', toggleSidebar, () => toggleSidebar(), { sidebarOpen: false }],
            ['toggleInspector', toggleInspector, () => toggleInspector(), { inspectorOpen: false }],
            ['toggleChatPanel', toggleChatPanel, () => toggleChatPanel(), { chatPanelOpen: true }],
            ['toggleMixer', toggleMixer, () => toggleMixer(), { mixerOpen: true }],
            [
                'toggleVirtualKeyboard',
                toggleVirtualKeyboard,
                () => toggleVirtualKeyboard(),
                { virtualKeyboardOpen: true },
            ],
            [
                'toggleAutomationPanel',
                toggleAutomationPanel,
                () => toggleAutomationPanel(),
                { automationPanelOpen: true },
            ],
            ['toggleTrackList', toggleTrackList, () => toggleTrackList(), { trackListOpen: false }],
            ['setSnapValue', setSnapValue, () => setSnapValue(0.25), { snapValue: 0.25 }],
            [
                'cycleChannelStripWidth',
                cycleChannelStripWidth,
                () => cycleChannelStripWidth(),
                { channelStripWidth: 'wide' },
            ],
            [
                'toggleCollaborationPanel',
                toggleCollaborationPanel,
                () => toggleCollaborationPanel(),
                { collaborationPanelOpen: true },
            ],
            ['toggleBranchManager', toggleBranchManager, () => toggleBranchManager(), { branchManagerOpen: true }],
            ['toggleUndoHistory', toggleUndoHistory, () => toggleUndoHistory(), { undoHistoryOpen: true }],
            [
                'toggleTimeDisplayMode',
                toggleTimeDisplayMode,
                () => toggleTimeDisplayMode(),
                { timeDisplayMode: 'time' },
            ],
            ['toggleCommandPalette', toggleCommandPalette, () => toggleCommandPalette(), { commandPaletteOpen: true }],
            ['toggleWorkspaceMode', toggleWorkspaceMode, () => toggleWorkspaceMode(), { mode: 'clip' }],
        ])('should patch state for %s', (_label, _subject, invoke, expected) => {
            vi.mocked(getWorkspaceState).mockReturnValue(base());
            vi.mocked(updateWorkspaceState).mockClear();
            invoke();
            expect(updateWorkspaceState).toHaveBeenCalledWith(expected);
        });

        it('should add a clip id to selection when toggling a new clip in', () => {
            vi.mocked(getWorkspaceState).mockReturnValue({
                ...base(),
                selectedClipIds: [],
            });
            vi.mocked(updateWorkspaceState).mockClear();

            toggleClipInSelection('n1');

            expect(updateWorkspaceState).toHaveBeenCalledWith({
                selectedClipId: 'n1',
                selectedClipIds: ['n1'],
            });
        });

        it('should remove a clip id when toggling an already selected clip', () => {
            vi.mocked(getWorkspaceState).mockReturnValue({
                ...base(),
                selectedClipIds: ['n1', 'n2'],
            });
            vi.mocked(updateWorkspaceState).mockClear();

            toggleClipInSelection('n1');

            expect(updateWorkspaceState).toHaveBeenCalledWith({
                selectedClipId: 'n1',
                selectedClipIds: ['n2'],
            });
        });
    });
});
