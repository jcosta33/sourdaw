import { addMarker, zoomTimelineBy } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { startOnboardingTour } from '#/modules/Onboarding/useCases';
import { transportStore, playheadPositionRef } from '#/modules/Transport/stores';
import {
    zoomToFit,
    zoomToSelection,
    toggleSidebar,
    toggleInspector,
    toggleMixer,
    toggleAutomationPanel,
} from '#/modules/WorkspaceShell/useCases';

import { type CallableCommandEntry } from '../searchCommandRegistry';
import { getSelectedClipId } from '../selectionHelpers/getSelectedClipId';

/** View commands — zoom, panels, workspace modes, tools, markers. */
export const viewCommands: CallableCommandEntry[] = [
    {
        id: 'zoom-to-fit',
        label: 'Zoom to Fit',
        description: 'Fit all clips in the visible timeline',
        category: 'View',
        shortcut: 'F',
        action: () => {
            zoomToFit();
        },
    },
    {
        id: 'zoom-to-selection',
        label: 'Zoom to Selection',
        description: 'Fit selected clips in the visible timeline',
        category: 'View',
        shortcut: '⇧F',
        action: () => {
            zoomToSelection();
        },
    },
    {
        id: 'zoom-in',
        label: 'Zoom In',
        description: 'Zoom into the timeline',
        category: 'View',
        shortcut: '+',
        action: () => {
            zoomTimelineBy(4);
        },
    },
    {
        id: 'zoom-out',
        label: 'Zoom Out',
        description: 'Zoom out of the timeline',
        category: 'View',
        shortcut: '-',
        action: () => {
            zoomTimelineBy(-4);
        },
    },
    {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        description: 'Show or hide the sidebar browser',
        category: 'View',
        shortcut: '⌘B',
        action: () => {
            toggleSidebar();
        },
    },
    {
        id: 'toggle-inspector',
        label: 'Toggle Inspector',
        description: 'Show or hide the inspector panel',
        category: 'View',
        shortcut: '⌘I',
        action: () => {
            toggleInspector();
        },
    },
    {
        id: 'toggle-chat-panel',
        label: 'Toggle AI Chat',
        description: 'Show or hide the AI Chat panel',
        category: 'View',
        shortcut: '⌘J',
        action: { type: 'toggleChatPanel' },
    },
    {
        id: 'toggle-mixer',
        label: 'Toggle Mixer',
        description: 'Show or hide the mixer panel',
        category: 'View',
        shortcut: '⌘M',
        action: () => {
            toggleMixer();
        },
    },
    {
        id: 'toggle-automation-panel',
        label: 'Toggle Automation Panel',
        description: 'Show or hide the automation panel',
        category: 'View',
        shortcut: '⌘⇧A',
        action: () => {
            toggleAutomationPanel();
        },
    },
    {
        id: 'arrange-mode',
        label: 'Arrange Mode',
        description: 'Switch to arrangement view',
        category: 'View',
        action: { type: 'setWorkspaceMode', payload: { mode: 'arrange' } },
    },
    {
        id: 'clip-mode',
        label: 'Clip Mode',
        description: 'Switch to clip editing view',
        category: 'View',
        shortcut: 'Tab',
        action: { type: 'setWorkspaceMode', payload: { mode: 'clip' } },
    },

    // ── Editing (Time) ────────────────────────────────────────
    {
        id: 'delete-time',
        label: 'Delete Time (Loop Region)',
        description: 'Delete time in the loop region, shifting everything left',
        category: 'Editing',
        action: () => {
            const time = transportStore.value;
            if (time) {
                void executeUserAppAction({
                    type: 'deleteTime',
                    payload: { startBeat: time.loopStart, endBeat: time.loopEnd },
                });
            }
        },
    },
    {
        id: 'insert-time',
        label: 'Insert Time at Playhead',
        description: 'Insert empty time at the playhead position (4 beats)',
        category: 'Editing',
        action: () => {
            const time = transportStore.value;
            if (time) {
                void executeUserAppAction({
                    type: 'insertTime',
                    payload: { atBeat: playheadPositionRef.current, durationBeats: 4 },
                });
            }
        },
    },
    {
        id: 'duplicate-time-range',
        label: 'Duplicate Time Range (Loop Region)',
        description: 'Duplicate the loop region and insert the copy after it',
        category: 'Editing',
        action: () => {
            const time = transportStore.value;
            if (time) {
                void executeUserAppAction({
                    type: 'duplicateTimeRange',
                    payload: { startBeat: time.loopStart, endBeat: time.loopEnd },
                });
            }
        },
    },
    {
        id: 'strip-silence',
        label: 'Strip Silence',
        description: 'Split the selected audio clip at silent sections',
        category: 'Editing',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'stripSilence', payload: { clipId } });
            }
        },
    },

    // ── Timeline ───────────────────────────────────────────────
    {
        id: 'add-marker',
        label: 'Add Marker',
        description: 'Add a marker at the playhead',
        category: 'Timeline',
        action: () => {
            const beat = transportStore.value ? playheadPositionRef.current : 0;
            addMarker(Math.floor(beat), `Marker ${Math.floor(beat) + 1}`);
        },
    },

    // ── Tools ──────────────────────────────────────────────────
    {
        id: 'tool-select',
        label: 'Select Tool',
        description: 'Switch to the select tool',
        category: 'Tools',
        shortcut: 'S / 1',
        action: { type: 'setEditingTool', payload: { tool: 'select' } },
    },
    {
        id: 'tool-cut',
        label: 'Cut Tool',
        description: 'Switch to the cut / split tool',
        category: 'Tools',
        shortcut: 'C / 2',
        action: { type: 'setEditingTool', payload: { tool: 'cut' } },
    },
    {
        id: 'tool-draw',
        label: 'Draw Tool',
        description: 'Switch to the draw tool',
        category: 'Tools',
        shortcut: 'D / 3',
        action: { type: 'setEditingTool', payload: { tool: 'draw' } },
    },
    {
        id: 'tool-automation',
        label: 'Automation Tool',
        description: 'Switch to the automation tool',
        category: 'Tools',
        shortcut: 'A / 4',
        action: { type: 'setEditingTool', payload: { tool: 'automation' } },
    },
    {
        id: 'tool-stretch',
        label: 'Stretch Tool',
        description: 'Switch to the stretch tool',
        category: 'Tools',
        shortcut: 'T / 5',
        action: { type: 'setEditingTool', payload: { tool: 'stretch' } },
    },

    {
        id: 'toggle-node-view',
        label: 'Toggle Node-Based Routing',
        description: 'Switch between linear inserts and a Fusion-style node graph view',
        category: 'View',
        action: { type: 'toggleNodeView' },
    },

    // ── Onboarding ─────────────────────────────────────────────
    {
        id: 'show-onboarding-tour',
        label: 'Show Tour Again',
        description: 'Re-run the guided onboarding tour for transport, tracks, inspector, mixer, and command palette',
        category: 'Help',
        action: () => {
            startOnboardingTour();
        },
    },
];
