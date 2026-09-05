import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addMarker, zoomTimelineBy } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { startOnboardingTour } from '#/modules/Onboarding/useCases';
import {
    zoomToFit,
    zoomToSelection,
    toggleSidebar,
    toggleInspector,
    toggleMixer,
    toggleAutomationPanel,
} from '#/modules/WorkspaceShell/useCases';

import { viewCommands } from '../ViewCommands';

const mocks = vi.hoisted(() => ({ transportValue: null as { loopStart: number; loopEnd: number } | null }));

vi.mock('#/modules/Arrangement/useCases', () => ({ addMarker: vi.fn(), zoomTimelineBy: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('#/modules/Onboarding/useCases', () => ({ startOnboardingTour: vi.fn() }));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportValue;
        },
    },
    playheadPositionRef: { current: 0 },
}));
vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleInspector: vi.fn(),
    toggleMixer: vi.fn(),
    toggleAutomationPanel: vi.fn(),
}));
vi.mock('../../selectionHelpers/getSelectedClipId', () => ({ getSelectedClipId: vi.fn() }));

function runAction(id: string): void {
    const command = viewCommands.find((entry) => entry.id === id);
    if (!command || typeof command.action !== 'function') {
        throw new Error(`Expected a callable action for ${id}`);
    }
    command.action();
}

describe('viewCommands', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.transportValue = { loopStart: 2, loopEnd: 10 };
        const { playheadPositionRef } = await import('#/modules/Transport/stores');
        playheadPositionRef.current = 6;
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue('clip-1');
    });

    it('exposes the view commands with their ids, labels, and categories', () => {
        expect(viewCommands.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category }))).toEqual([
            { id: 'zoom-to-fit', label: 'Zoom to Fit', category: 'View' },
            { id: 'zoom-to-selection', label: 'Zoom to Selection', category: 'View' },
            { id: 'zoom-in', label: 'Zoom In', category: 'View' },
            { id: 'zoom-out', label: 'Zoom Out', category: 'View' },
            { id: 'toggle-sidebar', label: 'Toggle Sidebar', category: 'View' },
            { id: 'toggle-inspector', label: 'Toggle Inspector', category: 'View' },
            { id: 'toggle-chat-panel', label: 'Toggle AI Chat', category: 'View' },
            { id: 'toggle-mixer', label: 'Toggle Mixer', category: 'View' },
            { id: 'toggle-automation-panel', label: 'Toggle Automation Panel', category: 'View' },
            { id: 'arrange-mode', label: 'Arrange Mode', category: 'View' },
            { id: 'clip-mode', label: 'Clip Mode', category: 'View' },
            { id: 'delete-time', label: 'Delete Time (Loop Region)', category: 'Editing' },
            { id: 'insert-time', label: 'Insert Time at Playhead', category: 'Editing' },
            { id: 'duplicate-time-range', label: 'Duplicate Time Range (Loop Region)', category: 'Editing' },
            { id: 'strip-silence', label: 'Strip Silence', category: 'Editing' },
            { id: 'add-marker', label: 'Add Marker', category: 'Timeline' },
            { id: 'tool-select', label: 'Select Tool', category: 'Tools' },
            { id: 'tool-cut', label: 'Cut Tool', category: 'Tools' },
            { id: 'tool-draw', label: 'Draw Tool', category: 'Tools' },
            { id: 'tool-automation', label: 'Automation Tool', category: 'Tools' },
            { id: 'tool-stretch', label: 'Stretch Tool', category: 'Tools' },
            { id: 'toggle-node-view', label: 'Toggle Node-Based Routing', category: 'View' },
            { id: 'show-onboarding-tour', label: 'Show Tour Again', category: 'Help' },
        ]);
    });

    it('dispatches the declarative action for each non-callable view command', () => {
        const staticEntries = [
            { id: 'toggle-chat-panel', action: { type: 'toggleChatPanel' } },
            { id: 'arrange-mode', action: { type: 'setWorkspaceMode', payload: { mode: 'arrange' } } },
            { id: 'clip-mode', action: { type: 'setWorkspaceMode', payload: { mode: 'clip' } } },
            { id: 'tool-select', action: { type: 'setEditingTool', payload: { tool: 'select' } } },
            { id: 'tool-cut', action: { type: 'setEditingTool', payload: { tool: 'cut' } } },
            { id: 'tool-draw', action: { type: 'setEditingTool', payload: { tool: 'draw' } } },
            { id: 'tool-automation', action: { type: 'setEditingTool', payload: { tool: 'automation' } } },
            { id: 'tool-stretch', action: { type: 'setEditingTool', payload: { tool: 'stretch' } } },
            { id: 'toggle-node-view', action: { type: 'toggleNodeView' } },
        ];

        for (const { id, action } of staticEntries) {
            const command = viewCommands.find((entry) => entry.id === id);
            expect(command?.action).toEqual(action);
        }
    });

    it('zoom-to-fit, zoom-to-selection, zoom-in, and zoom-out drive the timeline zoom', () => {
        runAction('zoom-to-fit');
        expect(zoomToFit).toHaveBeenCalledTimes(1);

        runAction('zoom-to-selection');
        expect(zoomToSelection).toHaveBeenCalledTimes(1);

        runAction('zoom-in');
        expect(zoomTimelineBy).toHaveBeenCalledWith(4);

        runAction('zoom-out');
        expect(zoomTimelineBy).toHaveBeenCalledWith(-4);
    });

    it('toggle-sidebar, toggle-inspector, toggle-mixer, and toggle-automation-panel toggle their panels', () => {
        runAction('toggle-sidebar');
        expect(toggleSidebar).toHaveBeenCalledTimes(1);

        runAction('toggle-inspector');
        expect(toggleInspector).toHaveBeenCalledTimes(1);

        runAction('toggle-mixer');
        expect(toggleMixer).toHaveBeenCalledTimes(1);

        runAction('toggle-automation-panel');
        expect(toggleAutomationPanel).toHaveBeenCalledTimes(1);
    });

    it('show-onboarding-tour restarts the guided tour', () => {
        runAction('show-onboarding-tour');

        expect(startOnboardingTour).toHaveBeenCalledTimes(1);
    });

    it('delete-time removes the loop region, shifting everything left', () => {
        runAction('delete-time');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'deleteTime',
            payload: { startBeat: 2, endBeat: 10 },
        });
    });

    it('insert-time inserts four beats at the playhead', () => {
        runAction('insert-time');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'insertTime',
            payload: { atBeat: 6, durationBeats: 4 },
        });
    });

    it('duplicate-time-range duplicates the loop region', () => {
        runAction('duplicate-time-range');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'duplicateTimeRange',
            payload: { startBeat: 2, endBeat: 10 },
        });
    });

    it('does not dispatch delete-time, insert-time, or duplicate-time-range without transport state', () => {
        mocks.transportValue = null;

        runAction('delete-time');
        runAction('insert-time');
        runAction('duplicate-time-range');

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('strip-silence splits the selected clip at silent sections', () => {
        runAction('strip-silence');

        expect(executeUserAppAction).toHaveBeenCalledWith({ type: 'stripSilence', payload: { clipId: 'clip-1' } });
    });

    it('strip-silence does not dispatch when no clip is selected', async () => {
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue(null);

        runAction('strip-silence');

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('add-marker adds a marker at the playhead position when transport state exists', () => {
        runAction('add-marker');

        expect(addMarker).toHaveBeenCalledWith(6, 'Marker 7');
    });

    it('add-marker falls back to beat 0 when there is no transport state', () => {
        mocks.transportValue = null;

        runAction('add-marker');

        expect(addMarker).toHaveBeenCalledWith(0, 'Marker 1');
    });
});
