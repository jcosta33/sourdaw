import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeUserAppAction } from '#/modules/Command/useCases';
import { openPreferencesDialog } from '#/modules/WorkspaceShell/useCases';

import { miscCommands } from '../MiscCommands';

vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('#/modules/WorkspaceShell/useCases', () => ({ openPreferencesDialog: vi.fn() }));
vi.mock('../../selectionHelpers/getSelectedClipId', () => ({ getSelectedClipId: vi.fn() }));

function runAction(id: string): void {
    const command = miscCommands.find((entry) => entry.id === id);
    if (!command || typeof command.action !== 'function') {
        throw new Error(`Expected a callable action for ${id}`);
    }
    command.action();
}

describe('miscCommands', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue('clip-1');
    });

    it('exposes the misc commands with their ids, labels, and categories', () => {
        expect(miscCommands.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category }))).toEqual([
            { id: 'preferences', label: 'Preferences', category: 'App' },
            { id: 'toggle-chord-track', label: 'Toggle Chord Track', category: 'Chords' },
            { id: 'add-chord-cmaj', label: 'Add C Major Chord', category: 'Chords' },
            { id: 'clear-chord-track', label: 'Clear Chord Track', category: 'Chords' },
            { id: 'toggle-scratch-pad', label: 'Toggle Scratch Pad', category: 'Arrangement' },
            { id: 'capture-scratch-pad', label: 'Capture to Scratch Pad', category: 'Arrangement' },
            { id: 'commit-scratch-pad', label: 'Apply Scratch Pad', category: 'Arrangement' },
            { id: 'clear-scratch-pad', label: 'Clear Scratch Pad', category: 'Arrangement' },
            { id: 'create-pattern-instance', label: 'Create Pattern Instance', category: 'Clips' },
            { id: 'detach-pattern-instance', label: 'Detach Pattern Instance', category: 'Clips' },
            { id: 'start-macro-recording', label: 'Start Macro Recording', category: 'Macros' },
            { id: 'stop-macro-recording', label: 'Stop Macro Recording', category: 'Macros' },
            { id: 'toggle-undo-tree', label: 'Toggle Branching Undo Tree', category: 'Editing' },
            { id: 'toggle-mono-monitor', label: 'Toggle Mono Monitoring', category: 'Monitoring' },
            { id: 'toggle-dim-monitor', label: 'Toggle Dim Monitoring', category: 'Monitoring' },
            { id: 'search-samples', label: 'Search Sample Library', category: 'Sound Library' },
            { id: 'toggle-punch-recording', label: 'Toggle Continuous Punch', category: 'Recording' },
            { id: 'trigger-scene-1', label: 'Trigger Scene 1', category: 'Performance' },
            { id: 'next-setlist-item', label: 'Next Setlist Item', category: 'Performance' },
            { id: 'previous-setlist-item', label: 'Previous Setlist Item', category: 'Performance' },
            { id: 'create-adjustment-eq', label: 'Add EQ Adjustment Layer', category: 'Mixing' },
            { id: 'create-adjustment-compressor', label: 'Add Compressor Adjustment Layer', category: 'Mixing' },
            { id: 'create-adjustment-reverb', label: 'Add Reverb Adjustment Layer', category: 'Mixing' },
            { id: 'create-adjustment-delay', label: 'Add Delay Adjustment Layer', category: 'Mixing' },
            { id: 'create-adjustment-saturation', label: 'Add Saturation Adjustment Layer', category: 'Mixing' },
            { id: 'create-adjustment-filter', label: 'Add Filter Adjustment Layer', category: 'Mixing' },
            {
                id: 'create-adjustment-stereo-width',
                label: 'Add Stereo Width Adjustment Layer',
                category: 'Mixing',
            },
            { id: 'create-adjustment-volume', label: 'Add Volume Adjustment Layer', category: 'Mixing' },
            { id: 'create-adjustment-pan', label: 'Add Pan Adjustment Layer', category: 'Mixing' },
            { id: 'quantize-to-grid-elastic', label: 'Quantize Audio to Grid (Elastic)', category: 'Editing' },
            { id: 'connect-mcu', label: 'Connect MCU Control Surface', category: 'Hardware' },
            { id: 'connect-osc', label: 'Connect OSC Control Surface', category: 'Hardware' },
            { id: 'connect-hui', label: 'Connect HUI Control Surface', category: 'Hardware' },
            { id: 'add-cv-pitch', label: 'Add CV Pitch Output', category: 'Hardware' },
            { id: 'add-cv-gate', label: 'Add Gate Output', category: 'Hardware' },
            { id: 'connect-push-2', label: 'Connect Ableton Push 2', category: 'Hardware' },
            { id: 'connect-push-3', label: 'Connect Ableton Push 3', category: 'Hardware' },
            { id: 'enable-warping', label: 'Enable Audio Warping', category: 'Editing' },
        ]);
    });

    it('dispatches the declarative action for each non-callable misc command', () => {
        const staticEntries = [
            { id: 'toggle-chord-track', action: { type: 'toggleChordTrack' } },
            {
                id: 'add-chord-cmaj',
                action: { type: 'addChordEvent', payload: { beat: 0, root: 0, quality: 'major', duration: 4 } },
            },
            { id: 'clear-chord-track', action: { type: 'clearChordTrack' } },
            { id: 'toggle-scratch-pad', action: { type: 'toggleScratchPad' } },
            { id: 'capture-scratch-pad', action: { type: 'captureScratchPad' } },
            { id: 'commit-scratch-pad', action: { type: 'commitScratchPad' } },
            { id: 'clear-scratch-pad', action: { type: 'clearScratchPad' } },
            {
                id: 'create-pattern-instance',
                action: {
                    type: 'createPatternInstance',
                    payload: { sourceClipId: '', targetTrackId: '', startBeat: 0 },
                },
            },
            { id: 'detach-pattern-instance', action: { type: 'detachPatternInstance', payload: { clipId: '' } } },
            { id: 'start-macro-recording', action: { type: 'startMacroRecording' } },
            { id: 'stop-macro-recording', action: { type: 'stopMacroRecording', payload: { name: 'New Macro' } } },
            { id: 'toggle-undo-tree', action: { type: 'toggleUndoTree' } },
            { id: 'toggle-mono-monitor', action: { type: 'toggleControlRoomMono' } },
            { id: 'toggle-dim-monitor', action: { type: 'toggleControlRoomDim' } },
            { id: 'search-samples', action: { type: 'searchSamples', payload: { query: '' } } },
            { id: 'toggle-punch-recording', action: { type: 'togglePunchRecording' } },
            { id: 'trigger-scene-1', action: { type: 'triggerScene', payload: { column: 0 } } },
            { id: 'next-setlist-item', action: { type: 'nextSetlistItem' } },
            { id: 'previous-setlist-item', action: { type: 'previousSetlistItem' } },
            {
                id: 'create-adjustment-eq',
                action: { type: 'createAdjustmentLayer', payload: { name: 'EQ Layer', effectType: 'eq' } },
            },
            {
                id: 'create-adjustment-compressor',
                action: {
                    type: 'createAdjustmentLayer',
                    payload: { name: 'Compressor Layer', effectType: 'compressor' },
                },
            },
            {
                id: 'create-adjustment-reverb',
                action: { type: 'createAdjustmentLayer', payload: { name: 'Reverb Layer', effectType: 'reverb' } },
            },
            {
                id: 'create-adjustment-delay',
                action: { type: 'createAdjustmentLayer', payload: { name: 'Delay Layer', effectType: 'delay' } },
            },
            {
                id: 'create-adjustment-saturation',
                action: {
                    type: 'createAdjustmentLayer',
                    payload: { name: 'Saturation Layer', effectType: 'saturation' },
                },
            },
            {
                id: 'create-adjustment-filter',
                action: { type: 'createAdjustmentLayer', payload: { name: 'Filter Layer', effectType: 'filter' } },
            },
            {
                id: 'create-adjustment-stereo-width',
                action: { type: 'createAdjustmentLayer', payload: { name: 'Width Layer', effectType: 'stereo-width' } },
            },
            {
                id: 'create-adjustment-volume',
                action: { type: 'createAdjustmentLayer', payload: { name: 'Volume Layer', effectType: 'volume' } },
            },
            {
                id: 'create-adjustment-pan',
                action: { type: 'createAdjustmentLayer', payload: { name: 'Pan Layer', effectType: 'pan' } },
            },
            { id: 'connect-mcu', action: { type: 'setControlSurface', payload: { protocol: 'mcu' } } },
            { id: 'connect-osc', action: { type: 'setControlSurface', payload: { protocol: 'osc' } } },
            { id: 'connect-hui', action: { type: 'setControlSurface', payload: { protocol: 'hui' } } },
            {
                id: 'add-cv-pitch',
                action: { type: 'addCvOutput', payload: { name: 'CV Pitch', channel: 1, type: 'cv-pitch' } },
            },
            { id: 'add-cv-gate', action: { type: 'addCvOutput', payload: { name: 'Gate', channel: 2, type: 'gate' } } },
            { id: 'connect-push-2', action: { type: 'connectPush', payload: { model: 'push2' } } },
            { id: 'connect-push-3', action: { type: 'connectPush', payload: { model: 'push3' } } },
        ];

        for (const { id, action } of staticEntries) {
            const command = miscCommands.find((entry) => entry.id === id);
            expect(command?.action).toEqual(action);
        }
    });

    it('preferences opens the application preferences dialog', () => {
        runAction('preferences');

        expect(openPreferencesDialog).toHaveBeenCalledTimes(1);
    });

    it('quantize-to-grid-elastic dispatches detectTransients for the selected clip', () => {
        runAction('quantize-to-grid-elastic');

        expect(executeUserAppAction).toHaveBeenCalledWith({ type: 'detectTransients', payload: { clipId: 'clip-1' } });
    });

    it('enable-warping dispatches enableWarping for the selected clip', () => {
        runAction('enable-warping');

        expect(executeUserAppAction).toHaveBeenCalledWith({ type: 'enableWarping', payload: { clipId: 'clip-1' } });
    });

    it('does not dispatch clip-scoped actions when no clip is selected', async () => {
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue(null);

        runAction('quantize-to-grid-elastic');
        runAction('enable-warping');

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });
});
