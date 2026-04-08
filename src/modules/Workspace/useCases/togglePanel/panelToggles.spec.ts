import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    setSoloMode,
    toggleSidebar,
    toggleInspector,
    toggleChatPanel,
    toggleMixer,
    toggleVirtualKeyboard,
    openVirtualKeyboard,
    setVirtualKeyboardOctave,
    setVirtualKeyboardVelocity,
    toggleAutomationPanel,
    toggleTrackList,
    setSnapValue,
    closeCollaborationPanel,
    closeUndoHistory,
    closeCommandPalette,
    selectClip,
    selectClipWithFocus,
    clearClipSelection,
    openMixer,
    openInspector,
    setTrackListWidth,
    closeScratchPad,
    cycleChannelStripWidth,
    toggleCollaborationPanel,
    toggleBranchManager,
    closeBranchManager,
    toggleUndoHistory,
    toggleTimeDisplayMode,
    toggleClipInSelection,
    setClipSelection,
    selectAllClips,
    toggleCommandPalette,
    toggleWorkspaceMode,
} from './panelToggles';
import { defaultWorkspaceState } from '../../models/WorkspaceState';

describe('panelToggles', () => {
    describe('functions that only call updateWorkspaceState', () => {
        it.each([
            ['openVirtualKeyboard', openVirtualKeyboard, () => openVirtualKeyboard(), { virtualKeyboardOpen: true }],
            ['setVirtualKeyboardOctave', setVirtualKeyboardOctave, () => setVirtualKeyboardOctave(5), { virtualKeyboardOctave: 5 }],
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
        ])('should call updateWorkspaceState for %s', (_label, subject, invoke, expected) => {
            const update = vi.fn();
            injectDependencies(subject as never, { updateWorkspaceState: update });
            invoke();
            expect(update).toHaveBeenCalledWith(expected);
        });
    });

    describe('functions that read then update workspace state', () => {
        const base = (): typeof defaultWorkspaceState => ({ ...defaultWorkspaceState });

        it.each([
            ['setSoloMode', setSoloMode, () => setSoloMode('pfl'), { soloMode: 'pfl' }],
            ['toggleSidebar', toggleSidebar, () => toggleSidebar(), { sidebarOpen: false }],
            ['toggleInspector', toggleInspector, () => toggleInspector(), { inspectorOpen: false }],
            ['toggleChatPanel', toggleChatPanel, () => toggleChatPanel(), { chatPanelOpen: true }],
            ['toggleMixer', toggleMixer, () => toggleMixer(), { mixerOpen: true }],
            ['toggleVirtualKeyboard', toggleVirtualKeyboard, () => toggleVirtualKeyboard(), { virtualKeyboardOpen: true }],
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
            [
                'toggleCommandPalette',
                toggleCommandPalette,
                () => toggleCommandPalette(),
                { commandPaletteOpen: true },
            ],
            [
                'toggleWorkspaceMode',
                toggleWorkspaceMode,
                () => toggleWorkspaceMode(),
                { mode: 'clip' },
            ],
        ])('should patch state for %s', (_label, subject, invoke, expected) => {
            const getState = vi.fn(() => base());
            const update = vi.fn();
            injectDependencies(subject as never, { getWorkspaceState: getState, updateWorkspaceState: update });
            invoke();
            expect(update).toHaveBeenCalledWith(expected);
        });

        it('should add a clip id to selection when toggling a new clip in', () => {
            const getState = vi.fn(() => ({
                ...base(),
                selectedClipIds: [],
            }));
            const update = vi.fn();
            injectDependencies(toggleClipInSelection, { getWorkspaceState: getState, updateWorkspaceState: update });

            toggleClipInSelection('n1');

            expect(update).toHaveBeenCalledWith({
                selectedClipId: 'n1',
                selectedClipIds: ['n1'],
            });
        });

        it('should remove a clip id when toggling an already selected clip', () => {
            const getState = vi.fn(() => ({
                ...base(),
                selectedClipIds: ['n1', 'n2'],
            }));
            const update = vi.fn();
            injectDependencies(toggleClipInSelection, { getWorkspaceState: getState, updateWorkspaceState: update });

            toggleClipInSelection('n1');

            expect(update).toHaveBeenCalledWith({
                selectedClipId: 'n1',
                selectedClipIds: ['n2'],
            });
        });
    });
});
