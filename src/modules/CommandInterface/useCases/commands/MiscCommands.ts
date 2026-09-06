import { executeUserAppAction } from '#/modules/Command/useCases';
import { openPreferencesDialog } from '#/modules/WorkspaceShell/useCases';

import { type CallableCommandEntry } from '../searchCommandRegistry';
import { getSelectedClipId } from '../selectionHelpers/getSelectedClipId';

/**
 * Miscellaneous commands covering: time editing, app settings,
 * chords, arrangement, clip patterns, macros, recording, performance
 * (loop station, setlist), mixing, hardware, extensions, and audio engine.
 */
export const miscCommands: CallableCommandEntry[] = [
    {
        id: 'preferences',
        label: 'Preferences',
        description: 'Open application preferences',
        category: 'App',
        shortcut: '⌘,',
        action: () => {
            openPreferencesDialog();
        },
    },

    // ── Chords ─────────────────────────────────────────────────
    {
        id: 'toggle-chord-track',
        label: 'Toggle Chord Track',
        description: 'Enable or disable the global chord track',
        category: 'Chords',
        action: { type: 'toggleChordTrack' },
    },
    {
        id: 'add-chord-cmaj',
        label: 'Add C Major Chord',
        description: 'Add a C major chord event at the next available position',
        category: 'Chords',
        action: { type: 'addChordEvent', payload: { beat: 0, root: 0, quality: 'major', duration: 4 } },
    },
    {
        id: 'clear-chord-track',
        label: 'Clear Chord Track',
        description: 'Remove all chord events from the chord track',
        category: 'Chords',
        action: { type: 'clearChordTrack' },
    },

    // ── Arrangement ────────────────────────────────────────────
    {
        id: 'toggle-scratch-pad',
        label: 'Toggle Scratch Pad',
        description: 'Open or close the arrangement scratch pad',
        category: 'Arrangement',
        action: { type: 'toggleScratchPad' },
    },
    {
        id: 'capture-scratch-pad',
        label: 'Capture to Scratch Pad',
        description: 'Snapshot the current arrangement sections into the scratch pad',
        category: 'Arrangement',
        action: { type: 'captureScratchPad' },
    },
    {
        id: 'commit-scratch-pad',
        label: 'Apply Scratch Pad',
        description: 'Replace main arrangement with scratch pad order',
        category: 'Arrangement',
        action: { type: 'commitScratchPad' },
    },
    {
        id: 'clear-scratch-pad',
        label: 'Clear Scratch Pad',
        description: 'Remove all sections from the scratch pad',
        category: 'Arrangement',
        action: { type: 'clearScratchPad' },
    },

    // ── Clips ──────────────────────────────────────────────────
    {
        id: 'create-pattern-instance',
        label: 'Create Pattern Instance',
        description: 'Create a linked copy of the selected clip (Figma-style)',
        category: 'Clips',
        action: { type: 'createPatternInstance', payload: { sourceClipId: '', targetTrackId: '', startBeat: 0 } },
    },
    {
        id: 'detach-pattern-instance',
        label: 'Detach Pattern Instance',
        description: 'Break the link between this clip and its parent pattern',
        category: 'Clips',
        action: { type: 'detachPatternInstance', payload: { clipId: '' } },
    },

    // ── Macros ─────────────────────────────────────────────────
    {
        id: 'start-macro-recording',
        label: 'Start Macro Recording',
        description: 'Begin recording actions as a replayable macro',
        category: 'Macros',
        action: { type: 'startMacroRecording' },
    },
    {
        id: 'stop-macro-recording',
        label: 'Stop Macro Recording',
        description: 'Stop recording and save the macro',
        category: 'Macros',
        action: { type: 'stopMacroRecording', payload: { name: 'New Macro' } },
    },

    // ── Undo Tree ──────────────────────────────────────────────
    {
        id: 'toggle-undo-tree',
        label: 'Toggle Branching Undo Tree',
        description: 'Enable/disable branching undo tree mode for non-destructive editing',
        category: 'Editing',
        action: { type: 'toggleUndoTree' },
    },

    // ── Control Room ──────────────────────────────────────────
    {
        id: 'toggle-mono-monitor',
        label: 'Toggle Mono Monitoring',
        description: 'Switch monitoring between stereo and mono for compatibility checking',
        category: 'Monitoring',
        action: { type: 'toggleControlRoomMono' },
    },
    {
        id: 'toggle-dim-monitor',
        label: 'Toggle Dim Monitoring',
        description: 'Reduce monitor volume to dim level for low-volume mixing checks',
        category: 'Monitoring',
        action: { type: 'toggleControlRoomDim' },
    },

    // ── Sample Management ─────────────────────────────────────
    {
        id: 'search-samples',
        label: 'Search Sample Library',
        description: 'Search and browse your sample database with auto-tagging and similarity search',
        category: 'Sound Library',
        action: { type: 'searchSamples', payload: { query: '' } },
    },

    // ── Extension / Scripting ─────────────────────────────────
    // Extension commands removed — runtime is unsandboxed (new Function).
    // TODO: Rebuild extension system with Worker-based sandbox before re-exposing.

    // ── Recording ─────────────────────────────────────────────
    {
        id: 'toggle-punch-recording',
        label: 'Toggle Continuous Punch',
        description: 'Enable background capture for non-destructive punch recording (QuickPunch)',
        category: 'Recording',
        action: { type: 'togglePunchRecording' },
    },

    // ── Loop Station ──────────────────────────────────────────
    {
        id: 'trigger-scene-1',
        label: 'Trigger Scene 1',
        description: 'Launch all loop slots in scene column 1',
        category: 'Performance',
        action: { type: 'triggerScene', payload: { column: 0 } },
    },

    // ── Setlist ───────────────────────────────────────────────
    {
        id: 'next-setlist-item',
        label: 'Next Setlist Item',
        description: 'Advance to the next song in the setlist',
        category: 'Performance',
        action: { type: 'nextSetlistItem' },
    },
    {
        id: 'previous-setlist-item',
        label: 'Previous Setlist Item',
        description: 'Go back to the previous song in the setlist',
        category: 'Performance',
        action: { type: 'previousSetlistItem' },
    },

    // ── Adjustment Layers ─────────────────────────────────────
    {
        id: 'create-adjustment-eq',
        label: 'Add EQ Adjustment Layer',
        description: 'Insert a non-destructive EQ layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'EQ Layer', effectType: 'eq' } },
    },
    {
        id: 'create-adjustment-compressor',
        label: 'Add Compressor Adjustment Layer',
        description: 'Insert a non-destructive compressor layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'Compressor Layer', effectType: 'compressor' } },
    },
    {
        id: 'create-adjustment-reverb',
        label: 'Add Reverb Adjustment Layer',
        description: 'Insert a non-destructive reverb layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'Reverb Layer', effectType: 'reverb' } },
    },
    {
        id: 'create-adjustment-delay',
        label: 'Add Delay Adjustment Layer',
        description: 'Insert a non-destructive delay layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'Delay Layer', effectType: 'delay' } },
    },
    {
        id: 'create-adjustment-saturation',
        label: 'Add Saturation Adjustment Layer',
        description: 'Insert a non-destructive saturation layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'Saturation Layer', effectType: 'saturation' } },
    },
    {
        id: 'create-adjustment-filter',
        label: 'Add Filter Adjustment Layer',
        description: 'Insert a non-destructive filter layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'Filter Layer', effectType: 'filter' } },
    },
    {
        id: 'create-adjustment-stereo-width',
        label: 'Add Stereo Width Adjustment Layer',
        description: 'Insert a non-destructive stereo-width layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'Width Layer', effectType: 'stereo-width' } },
    },
    {
        id: 'create-adjustment-volume',
        label: 'Add Volume Adjustment Layer',
        description: 'Insert a non-destructive volume layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'Volume Layer', effectType: 'volume' } },
    },
    {
        id: 'create-adjustment-pan',
        label: 'Add Pan Adjustment Layer',
        description: 'Insert a non-destructive pan layer that applies to tracks below',
        category: 'Mixing',
        action: { type: 'createAdjustmentLayer', payload: { name: 'Pan Layer', effectType: 'pan' } },
    },

    // ── Elastic Audio ─────────────────────────────────────────
    {
        id: 'quantize-to-grid-elastic',
        label: 'Quantize Audio to Grid (Elastic)',
        description: 'Detect transients and time-align them to the grid',
        category: 'Editing',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'detectTransients', payload: { clipId } });
            }
        },
    },

    // ── Control Surfaces ──────────────────────────────────────
    {
        id: 'connect-mcu',
        label: 'Connect MCU Control Surface',
        description: 'Enable Mackie Control Universal protocol (10-bit faders)',
        category: 'Hardware',
        action: { type: 'setControlSurface', payload: { protocol: 'mcu' } },
    },
    {
        id: 'connect-osc',
        label: 'Connect OSC Control Surface',
        description: 'Enable OSC protocol for TouchOSC and similar controllers',
        category: 'Hardware',
        action: { type: 'setControlSurface', payload: { protocol: 'osc' } },
    },
    {
        id: 'connect-hui',
        label: 'Connect HUI Control Surface',
        description: 'Enable HUI protocol for Pro Tools compatible surfaces',
        category: 'Hardware',
        action: { type: 'setControlSurface', payload: { protocol: 'hui' } },
    },

    // ── CV/Gate ───────────────────────────────────────────────
    {
        id: 'add-cv-pitch',
        label: 'Add CV Pitch Output',
        description: 'Add a 1V/octave CV pitch output for modular synth control',
        category: 'Hardware',
        action: { type: 'addCvOutput', payload: { name: 'CV Pitch', channel: 1, type: 'cv-pitch' } },
    },
    {
        id: 'add-cv-gate',
        label: 'Add Gate Output',
        description: 'Add a gate output for modular synth triggering',
        category: 'Hardware',
        action: { type: 'addCvOutput', payload: { name: 'Gate', channel: 2, type: 'gate' } },
    },

    // ── Push ──────────────────────────────────────────────────
    {
        id: 'connect-push-2',
        label: 'Connect Ableton Push 2',
        description: 'Enable deep hardware integration with Ableton Push 2',
        category: 'Hardware',
        action: { type: 'connectPush', payload: { model: 'push2' } },
    },
    {
        id: 'connect-push-3',
        label: 'Connect Ableton Push 3',
        description: 'Enable deep hardware integration with Ableton Push 3',
        category: 'Hardware',
        action: { type: 'connectPush', payload: { model: 'push3' } },
    },

    // ── Audio Warping ─────────────────────────────────────────
    {
        id: 'enable-warping',
        label: 'Enable Audio Warping',
        description: 'Enable time-stretch/pitch-shift warping on the selected clip',
        category: 'Editing',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'enableWarping', payload: { clipId } });
            }
        },
    },
];
