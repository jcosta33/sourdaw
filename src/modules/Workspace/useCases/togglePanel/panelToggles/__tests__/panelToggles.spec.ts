import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
    const state = {
        mode: 'arrange' as const,
        sidebarOpen: false,
        mixerOpen: false,
        inspectorOpen: false,
        trackListOpen: false,
        virtualKeyboardOpen: false,
        chatPanelOpen: false,
        commandPaletteOpen: false,
        undoHistoryOpen: false,
        collaborationPanelOpen: false,
        branchManagerOpen: false,
        automationPanelOpen: false,
        automationPanelWidth: 400,
        scratchPadOpen: false,
        scratchPadHeight: 120,
        activeTool: 'select' as const,
        selectedClipId: null as string | null,
        selectedClipIds: [] as string[],
        marqueeSelection: null,
        soloMode: 'sip' as const,
        snapValue: 0.25,
        trackListWidth: 200,
        sidebarWidth: 224,
        inspectorWidth: 256,
        mixerHeight: 208,
        channelStripWidth: 'normal' as const,
        timeDisplayMode: 'musical' as const,
        chatPanelWidth: 320,
        rippleEditing: false,
        dualViewOpen: false,
        sessionViewWidth: 320,
        automationVisibility: 'hidden' as const,
        automationSubLanes: {} as Record<string, string[]>,
        aiPanelWidth: 340,
        fermenterHeight: 320,
        toasterHeight: 420,
        levainHeight: 340,
        glutenHeight: 300,
        bacteriaHeight: 400,
        grinderHeight: 380,
        proofChamberHeight: 380,
        proofHeight: 340,
        scoringHeight: 300,
        yeastHeight: 300,
        crustHeight: 360,
        samplerHeight: 400,
        grandBouleHeight: 420,
        virtualKeyboardOctave: 4,
        virtualKeyboardHeight: 128,
        virtualKeyboardVelocity: 100,
    };
    return {
        getState: vi.fn<() => (typeof getWs)['getWorkspaceState'] extends () => infer R ? R : never>(() => state),
        updateState: vi.fn<(typeof updateWs)['updateWorkspaceState']>((patch: Record<string, unknown>) => {
            Object.assign(state, patch);
        }),
        resetState: () => {
            state.sidebarOpen = false;
            state.mixerOpen = false;
            state.inspectorOpen = false;
            state.trackListOpen = false;
            state.virtualKeyboardOpen = false;
            state.chatPanelOpen = false;
            state.commandPaletteOpen = false;
            state.undoHistoryOpen = false;
            state.collaborationPanelOpen = false;
            state.branchManagerOpen = false;
            state.automationPanelOpen = false;
            state.scratchPadOpen = false;
        },
    };
});

vi.mock('../../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: mocks.getState }));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: mocks.updateState }));

import { closeCollaborationPanel } from '../closeCollaborationPanel';
import { closeCommandPalette } from '../closeCommandPalette';
import { closeUndoHistory } from '../closeUndoHistory';
import { openInspector } from '../openInspector';
import { openMixer } from '../openMixer';
import { openVirtualKeyboard } from '../openVirtualKeyboard';
import { setSnapValue } from '../setSnapValue';
import { setSoloMode } from '../setSoloMode';
import { setTrackListWidth } from '../setTrackListWidth';
import { setVirtualKeyboardOctave } from '../setVirtualKeyboardOctave';
import { setVirtualKeyboardVelocity } from '../setVirtualKeyboardVelocity';
import { toggleChatPanel } from '../toggleChatPanel';
import { toggleCollaborationPanel } from '../toggleCollaborationPanel';
import { toggleCommandPalette } from '../toggleCommandPalette';
import { toggleInspector } from '../toggleInspector';
import { toggleMixer } from '../toggleMixer';
import { toggleSidebar } from '../toggleSidebar';
import { toggleTrackList } from '../toggleTrackList';
import { toggleUndoHistory } from '../toggleUndoHistory';
import { toggleVirtualKeyboard } from '../toggleVirtualKeyboard';

import type * as getWs from '../../../../repositories/getWorkspaceState';
import type * as updateWs from '../../../../repositories/updateWorkspaceState';

describe('panel toggle functions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetState();
    });

    describe('toggle functions flip boolean state', () => {
        it('toggleSidebar flips sidebarOpen', () => {
            toggleSidebar();
            expect(mocks.updateState).toHaveBeenCalledWith({ sidebarOpen: true });
            toggleSidebar();
            expect(mocks.updateState).toHaveBeenLastCalledWith({ sidebarOpen: false });
        });

        it('toggleMixer flips mixerOpen', () => {
            toggleMixer();
            expect(mocks.updateState).toHaveBeenCalledWith({ mixerOpen: true });
        });

        it('toggleInspector flips inspectorOpen', () => {
            toggleInspector();
            expect(mocks.updateState).toHaveBeenCalledWith({ inspectorOpen: true });
        });

        it('toggleTrackList flips trackListOpen', () => {
            toggleTrackList();
            expect(mocks.updateState).toHaveBeenCalledWith({ trackListOpen: true });
        });

        it('toggleVirtualKeyboard flips virtualKeyboardOpen', () => {
            toggleVirtualKeyboard();
            expect(mocks.updateState).toHaveBeenCalledWith({ virtualKeyboardOpen: true });
        });

        it('toggleChatPanel flips chatPanelOpen', () => {
            toggleChatPanel();
            expect(mocks.updateState).toHaveBeenCalledWith({ chatPanelOpen: true });
        });

        it('toggleCommandPalette flips commandPaletteOpen', () => {
            toggleCommandPalette();
            expect(mocks.updateState).toHaveBeenCalledWith({ commandPaletteOpen: true });
        });

        it('toggleUndoHistory flips undoHistoryOpen', () => {
            toggleUndoHistory();
            expect(mocks.updateState).toHaveBeenCalledWith({ undoHistoryOpen: true });
        });

        it('toggleCollaborationPanel flips collaborationPanelOpen', () => {
            toggleCollaborationPanel();
            expect(mocks.updateState).toHaveBeenCalledWith({ collaborationPanelOpen: true });
        });
    });

    describe('close functions set false', () => {
        it('closeCommandPalette sets false', () => {
            closeCommandPalette();
            expect(mocks.updateState).toHaveBeenCalledWith({ commandPaletteOpen: false });
        });

        it('closeUndoHistory sets false', () => {
            closeUndoHistory();
            expect(mocks.updateState).toHaveBeenCalledWith({ undoHistoryOpen: false });
        });

        it('closeCollaborationPanel sets false', () => {
            closeCollaborationPanel();
            expect(mocks.updateState).toHaveBeenCalledWith({ collaborationPanelOpen: false });
        });
    });

    describe('open functions set true', () => {
        it('openInspector sets true', () => {
            openInspector();
            expect(mocks.updateState).toHaveBeenCalledWith({ inspectorOpen: true });
        });

        it('openMixer sets true', () => {
            openMixer();
            expect(mocks.updateState).toHaveBeenCalledWith({ mixerOpen: true });
        });

        it('openVirtualKeyboard sets true', () => {
            openVirtualKeyboard();
            expect(mocks.updateState).toHaveBeenCalledWith({ virtualKeyboardOpen: true });
        });
    });

    describe('set functions write values with clamping', () => {
        it('setSoloMode writes mode string', () => {
            setSoloMode('afl');
            expect(mocks.updateState).toHaveBeenCalledWith({ soloMode: 'afl' });
        });

        it('setSnapValue writes snap value', () => {
            setSnapValue(0.125);
            expect(mocks.updateState).toHaveBeenCalledWith({ snapValue: 0.125 });
        });

        it('setTrackListWidth writes width', () => {
            setTrackListWidth(300);
            expect(mocks.updateState).toHaveBeenCalledWith({ trackListWidth: 300 });
        });

        it('setVirtualKeyboardOctave clamps to 0-8', () => {
            setVirtualKeyboardOctave(5);
            expect(mocks.updateState).toHaveBeenCalledWith({ virtualKeyboardOctave: 5 });
            setVirtualKeyboardOctave(-1);
            expect(mocks.updateState).toHaveBeenLastCalledWith({ virtualKeyboardOctave: 0 });
            setVirtualKeyboardOctave(10);
            expect(mocks.updateState).toHaveBeenLastCalledWith({ virtualKeyboardOctave: 8 });
        });

        it('setVirtualKeyboardVelocity clamps to 1-127', () => {
            setVirtualKeyboardVelocity(85);
            expect(mocks.updateState).toHaveBeenCalledWith({ virtualKeyboardVelocity: 85 });
            setVirtualKeyboardVelocity(0);
            expect(mocks.updateState).toHaveBeenLastCalledWith({ virtualKeyboardVelocity: 1 });
            setVirtualKeyboardVelocity(200);
            expect(mocks.updateState).toHaveBeenLastCalledWith({ virtualKeyboardVelocity: 127 });
        });
    });
});
