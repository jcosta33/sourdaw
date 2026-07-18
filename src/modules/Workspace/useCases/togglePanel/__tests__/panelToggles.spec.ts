import { describe, it, expect, vi } from 'vitest';

import { defaultWorkspaceState } from '../../../models/WorkspaceState';
import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';
import { closeBranchManager } from '../panelToggles/closeBranchManager';
import { closeCollaborationPanel } from '../panelToggles/closeCollaborationPanel';
import { closeCommandPalette } from '../panelToggles/closeCommandPalette';
import { closeScratchPad } from '../panelToggles/closeScratchPad';
import { closeUndoHistory } from '../panelToggles/closeUndoHistory';
import { cycleChannelStripWidth } from '../panelToggles/cycleChannelStripWidth';
import { openInspector } from '../panelToggles/openInspector';
import { openMixer } from '../panelToggles/openMixer';
import { openVirtualKeyboard } from '../panelToggles/openVirtualKeyboard';
import { setSnapValue } from '../panelToggles/setSnapValue';
import { setSoloMode } from '../panelToggles/setSoloMode';
import { setTrackListWidth } from '../panelToggles/setTrackListWidth';
import { setVirtualKeyboardOctave } from '../panelToggles/setVirtualKeyboardOctave';
import { setVirtualKeyboardVelocity } from '../panelToggles/setVirtualKeyboardVelocity';
import { toggleAutomationPanel } from '../panelToggles/toggleAutomationPanel';
import { toggleBranchManager } from '../panelToggles/toggleBranchManager';
import { toggleChatPanel } from '../panelToggles/toggleChatPanel';
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
            ['openMixer', openMixer, () => openMixer(), { mixerOpen: true }],
            ['openInspector', openInspector, () => openInspector(), { inspectorOpen: true }],
            ['setTrackListWidth', setTrackListWidth, () => setTrackListWidth(300), { trackListWidth: 300 }],
            ['closeScratchPad', closeScratchPad, () => closeScratchPad(), { scratchPadOpen: false }],
            ['closeBranchManager', closeBranchManager, () => closeBranchManager(), { branchManagerOpen: false }],
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
    });
});
