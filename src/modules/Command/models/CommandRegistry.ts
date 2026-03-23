import { type AppAction } from './AppAction';
import {
    getSelectedTrackId,
    getSelectedClipId,
    getSelectedClipIds,
    getAllClipIds,
    getLastClipEndBeat,
    goToNextMarker,
    goToPreviousMarker,
} from '../helpers/selectionHelpers';
import { saveProject, newProject } from '#/modules/Project/useCases/projectPersistence';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { addMarker } from '#/modules/Timeline/useCases/markerUseCases';
import { duplicateTrack } from '#/modules/Track/useCases/duplicateTrack';
import { undo, redo } from '#/modules/Command/useCases/undoRedo';
import { copySelectedClip, cutSelectedClip, pasteClip } from '#/modules/Clip/useCases/clipboardUseCases';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { zoomTimeline } from '#/modules/Timeline/stores/timelineViewStore';
import {
    zoomToFit,
    zoomToSelection,
    toggleSidebar,
    toggleInspector,
    toggleMixer,
    toggleAutomationPanel,
} from '#/modules/Workspace/useCases/togglePanel';
import { seekPlayhead } from '#/modules/Transport/useCases/transportControls';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { removeTrack } from '#/modules/Track/useCases/removeTrack';
import { splitClip, renameClip } from '#/modules/Clip/useCases/clipEditingUseCases';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
import { automationStore } from '#/modules/Automation/stores/automationStore';

export type CommandEntry = {
    id: string;
    label: string;
    description: string;
    category: string;
    shortcut?: string;
    action: AppAction | (() => void);
};

export const commandRegistry: CommandEntry[] = [
    // ── Transport ──────────────────────────────────────────────
    {
        id: 'toggle-playback',
        label: 'Play / Pause',
        description: 'Toggle transport playback',
        category: 'Transport',
        shortcut: 'Space',
        action: { type: 'togglePlayback' },
    },
    {
        id: 'stop',
        label: 'Stop',
        description: 'Stop and return to start',
        category: 'Transport',
        shortcut: 'Esc',
        action: { type: 'stopPlayback' },
    },
    {
        id: 'toggle-recording',
        label: 'Toggle Recording',
        description: 'Start or stop recording',
        category: 'Transport',
        shortcut: 'R',
        action: { type: 'toggleRecording' },
    },
    {
        id: 'toggle-loop',
        label: 'Toggle Loop',
        description: 'Enable or disable loop',
        category: 'Transport',
        shortcut: 'L',
        action: { type: 'toggleLoop' },
    },
    {
        id: 'toggle-metronome',
        label: 'Toggle Metronome',
        description: 'Enable or disable metronome',
        category: 'Transport',
        shortcut: 'M',
        action: { type: 'toggleMetronome' },
    },
    {
        id: 'go-to-start',
        label: 'Go to Start',
        description: 'Move playhead to beat 0',
        category: 'Transport',
        shortcut: 'Home',
        action: () => {
            seekPlayhead(0);
        },
    },
    {
        id: 'go-to-end',
        label: 'Go to End',
        description: 'Move playhead to last clip end',
        category: 'Transport',
        shortcut: 'End',
        action: () => {
            seekPlayhead(getLastClipEndBeat());
        },
    },
    {
        id: 'next-marker',
        label: 'Next Marker',
        description: 'Jump to the next marker',
        category: 'Transport',
        shortcut: ']',
        action: () => {
            goToNextMarker();
        },
    },
    {
        id: 'prev-marker',
        label: 'Previous Marker',
        description: 'Jump to the previous marker',
        category: 'Transport',
        shortcut: '[',
        action: () => {
            goToPreviousMarker();
        },
    },

    // ── Edit ───────────────────────────────────────────────────
    {
        id: 'undo',
        label: 'Undo',
        description: 'Undo last action',
        category: 'Edit',
        shortcut: '⌘Z',
        action: () => {
            undo();
        },
    },
    {
        id: 'redo',
        label: 'Redo',
        description: 'Redo last undone action',
        category: 'Edit',
        shortcut: '⌘⇧Z',
        action: () => {
            redo();
        },
    },
    {
        id: 'copy-clip',
        label: 'Copy Clip',
        description: 'Copy the selected clip',
        category: 'Edit',
        shortcut: '⌘C',
        action: () => {
            copySelectedClip();
        },
    },
    {
        id: 'cut-clip',
        label: 'Cut Clip',
        description: 'Cut the selected clip',
        category: 'Edit',
        shortcut: '⌘X',
        action: () => {
            cutSelectedClip();
        },
    },
    {
        id: 'paste-clip',
        label: 'Paste Clip',
        description: 'Paste clip at playhead',
        category: 'Edit',
        shortcut: '⌘V',
        action: () => {
            pasteClip();
        },
    },
    {
        id: 'select-all',
        label: 'Select All Clips',
        description: 'Select every clip on the timeline',
        category: 'Edit',
        shortcut: '⌘A',
        action: () => {
            const ws = workspaceStore.value;
            if (ws) {
                workspaceStore.set({ ...ws, selectedClipIds: getAllClipIds(), selectedClipId: null });
            }
        },
    },
    {
        id: 'deselect-all',
        label: 'Deselect All',
        description: 'Clear clip selection',
        category: 'Edit',
        shortcut: '⌘⇧A',
        action: () => {
            const ws = workspaceStore.value;
            if (ws) {
                workspaceStore.set({ ...ws, selectedClipIds: [], selectedClipId: null });
            }
        },
    },

    // ── Track ──────────────────────────────────────────────────
    {
        id: 'add-audio-track',
        label: 'Add Audio Track',
        description: 'Create a new audio track',
        category: 'Track',
        shortcut: '⇧N',
        action: { type: 'addTrack', payload: { name: 'Audio', kind: 'audio' } },
    },
    {
        id: 'add-midi-track',
        label: 'Add MIDI Track',
        description: 'Create a new MIDI track',
        category: 'Track',
        shortcut: 'N',
        action: { type: 'addTrack', payload: { name: 'MIDI', kind: 'midi' } },
    },
    {
        id: 'add-bus',
        label: 'Add Bus Track',
        description: 'Create a new bus track',
        category: 'Track',
        action: { type: 'createBus', payload: { name: 'Bus' } },
    },
    {
        id: 'add-folder',
        label: 'Create Folder',
        description: 'Create a track folder',
        category: 'Track',
        action: { type: 'createFolder', payload: { name: 'Folder' } },
    },
    {
        id: 'duplicate-track',
        label: 'Duplicate Track',
        description: 'Duplicate the selected track with all clips and devices',
        category: 'Track',
        shortcut: '⌘⇧D',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                duplicateTrack(id);
            }
        },
    },
    {
        id: 'delete-track',
        label: 'Delete Track',
        description: 'Remove the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                removeTrack(id);
            }
        },
    },
    {
        id: 'rename-track',
        label: 'Rename Track',
        description: 'Rename the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                const name = window.prompt('New track name:');
                if (name) {
                    void executeAppAction({ type: 'renameTrack', payload: { trackId: id, name } });
                }
            }
        },
    },
    {
        id: 'freeze-track',
        label: 'Freeze Track',
        description: 'Freeze the selected track to save CPU',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'freezeTrack', payload: { trackId: id } });
            }
        },
    },
    {
        id: 'unfreeze-track',
        label: 'Unfreeze Track',
        description: 'Unfreeze the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'unfreezeTrack', payload: { trackId: id } });
            }
        },
    },
    {
        id: 'bounce-to-new-track',
        label: 'Bounce to New Track',
        description: 'Render the selected track to a new audio track',
        category: 'Track',
        action: () => {
            const trackId = getSelectedTrackId();
            if (trackId) {
                void executeAppAction({ type: 'bounceToNewTrack', payload: { trackId } });
            }
        },
    },
    {
        id: 'bounce-in-place',
        label: 'Bounce in Place',
        description: 'Render the selected track to audio in place',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'bounceInPlace', payload: { trackId: id } });
            }
        },
    },
    {
        id: 'arm-track',
        label: 'Arm Track',
        description: 'Arm the selected track for recording',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'armTrack', payload: { trackId: id, armed: true } });
            }
        },
    },
    {
        id: 'solo-track',
        label: 'Solo Track',
        description: 'Solo the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'soloTrack', payload: { trackId: id, soloed: true } });
            }
        },
    },
    {
        id: 'mute-track',
        label: 'Mute Track',
        description: 'Mute the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'muteTrack', payload: { trackId: id, muted: true } });
            }
        },
    },
    {
        id: 'group-tracks',
        label: 'Group Selected Tracks',
        description: 'Link selected tracks into a group',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'groupTracks', payload: { trackIds: [id], name: 'Group' } });
            }
        },
    },
    {
        id: 'clear-solos',
        label: 'Clear All Solos',
        description: 'Unsolo all tracks',
        category: 'Track',
        shortcut: '⌥S',
        action: { type: 'clearSolos' },
    },
    {
        id: 'consolidate-all-tracks',
        label: 'Consolidate All Tracks',
        description: 'Bounce in place all audio and MIDI tracks',
        category: 'Track',
        action: { type: 'consolidateAllTracks' },
    },
    {
        id: 'ungroup-tracks',
        label: 'Ungroup Tracks',
        description: 'Remove track grouping',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                const track = trackStore.value?.tracks.find((t) => t.id === id);
                if (track?.groupId) {
                    void executeAppAction({ type: 'ungroupTracks', payload: { groupId: track.groupId } });
                }
            }
        },
    },

    // ── Clip ───────────────────────────────────────────────────
    {
        id: 'rename-clip',
        label: 'Rename Clip',
        description: 'Rename the selected clip',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                const track = trackStore.value?.tracks.find((t) => t.clips.some((c) => c.id === clipId));
                const clip = track?.clips.find((c) => c.id === clipId);
                const name = window.prompt('Rename clip:', clip?.name ?? '');
                if (name !== null && name.trim()) {
                    renameClip(clipId, name.trim());
                }
            }
        },
    },
    {
        id: 'split-clip',
        label: 'Split Clip at Playhead',
        description: 'Split the selected clip at the current playhead position',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            const beat = transportStore.value ? playheadPositionRef.current : 0;
            if (clipId) {
                splitClip(clipId, beat);
            }
        },
    },
    {
        id: 'normalize-clip',
        label: 'Normalize Clip',
        description: 'Peak-normalize the selected audio clip',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'normalizeClip', payload: { clipId } });
            }
        },
    },
    {
        id: 'reverse-clip',
        label: 'Reverse Clip',
        description: 'Reverse the selected audio clip',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'reverseClip', payload: { clipId } });
            }
        },
    },
    {
        id: 'glue-clips',
        label: 'Glue Selected Clips',
        description: 'Merge selected clips into one',
        category: 'Clip',
        action: () => {
            const ids = getSelectedClipIds();
            if (ids.length >= 2) {
                void executeAppAction({ type: 'glueClips', payload: { clipIds: ids } });
            }
        },
    },
    {
        id: 'consolidate-selection',
        label: 'Consolidate Selection',
        description: 'Consolidate the selection range into a single clip',
        category: 'Clip',
        action: () => {
            const trackId = getSelectedTrackId();
            const clipId = getSelectedClipId();
            if (trackId && clipId) {
                const track = trackStore.value?.tracks.find((t) => t.id === trackId);
                const clip = track?.clips.find((c) => c.id === clipId);
                if (clip) {
                    void executeAppAction({
                        type: 'consolidateSelection',
                        payload: { trackId, startBeat: clip.startBeat, endBeat: clip.endBeat },
                    });
                }
            }
        },
    },
    {
        id: 'set-clip-loop',
        label: 'Toggle Clip Loop',
        description: 'Enable or disable looping on the selected clip',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                const track = trackStore.value?.tracks.find((t) => t.clips.some((c) => c.id === clipId));
                const clip = track?.clips.find((c) => c.id === clipId);
                if (clip) {
                    void executeAppAction({ type: 'setClipLoop', payload: { clipId, enabled: !clip.loopEnabled } });
                }
            }
        },
    },

    // ── MIDI ───────────────────────────────────────────────────
    {
        id: 'quantize-notes',
        label: 'Quantize Notes',
        description: 'Quantize MIDI notes in the selected clip to the grid',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'quantizeNotes', payload: { clipId, gridSize: 1 } });
            }
        },
    },
    {
        id: 'transpose-up',
        label: 'Transpose Up',
        description: 'Transpose notes up one semitone',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'transposeNotes', payload: { clipId, semitones: 1 } });
            }
        },
    },
    {
        id: 'transpose-down',
        label: 'Transpose Down',
        description: 'Transpose notes down one semitone',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'transposeNotes', payload: { clipId, semitones: -1 } });
            }
        },
    },
    {
        id: 'transpose-up-octave',
        label: 'Transpose Up Octave',
        description: 'Transpose notes up 12 semitones',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'transposeNotes', payload: { clipId, semitones: 12 } });
            }
        },
    },
    {
        id: 'transpose-down-octave',
        label: 'Transpose Down Octave',
        description: 'Transpose notes down 12 semitones',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'transposeNotes', payload: { clipId, semitones: -12 } });
            }
        },
    },
    {
        id: 'humanize-notes',
        label: 'Humanize Notes',
        description: 'Add subtle timing and velocity variation',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'humanizeNotes', payload: { clipId, amount: 0.3 } });
            }
        },
    },
    {
        id: 'invert-notes',
        label: 'Invert Notes',
        description: 'Mirror MIDI notes around the center pitch',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'invertNotes', payload: { clipId } });
            }
        },
    },

    // ── AI / Generation ────────────────────────────────────────
    {
        id: 'generate-drums',
        label: 'Generate Drum Pattern',
        description: 'Create an algorithmic drum pattern on a MIDI track',
        category: 'AI',
        action: { type: 'generateDrumPattern', payload: { style: 'rock' } },
    },
    {
        id: 'generate-melody',
        label: 'Generate Melody',
        description: 'Create an algorithmic melody on a MIDI track',
        category: 'AI',
        action: { type: 'generateMelody', payload: { style: 'simple' } },
    },
    {
        id: 'generate-chords',
        label: 'Generate Chords',
        description: 'Create a chord progression on a MIDI track',
        category: 'AI',
        action: { type: 'generateChordProgression', payload: { style: 'pop' } },
    },
    {
        id: 'analyze-mix',
        label: 'Analyze Mix',
        description: 'Run frequency and level analysis on the mix',
        category: 'AI',
        action: { type: 'analyzeMix' },
    },
    {
        id: 'auto-fix-mix',
        label: 'Auto-Fix Mix',
        description: 'Analyze and automatically fix mix issues',
        category: 'AI',
        action: { type: 'autoFixMix' },
    },
    {
        id: 'arpeggiate',
        label: 'Arpeggiate MIDI',
        description: 'Arpeggiate the selected MIDI clip (up/down/random patterns)',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                executeAppAction({ type: 'arpeggiate', payload: { clipId } });
            }
        },
    },
    {
        id: 'detect-tempo',
        label: 'Detect Tempo',
        description: 'Detect the BPM of the selected audio clip',
        category: 'AI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'detectTempo', payload: { clipId } });
            }
        },
    },
    {
        id: 'detect-key',
        label: 'Detect Key',
        description: 'Detect the musical key of the selected audio clip',
        category: 'AI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'detectKey', payload: { clipId } });
            }
        },
    },
    {
        id: 'audio-to-midi',
        label: 'Audio to MIDI',
        description: 'Convert the selected audio clip to MIDI notes',
        category: 'AI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'audioToMidi', payload: { clipId } });
            }
        },
    },
    {
        id: 'apply-groove',
        label: 'Apply Groove Template',
        description: 'Apply a groove template to the selected clip',
        category: 'AI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'applyGroove', payload: { clipId, grooveId: 'swing-light' } });
            }
        },
    },

    // ── Automation ──────────────────────────────────────────────
    {
        id: 'scale-automation',
        label: 'Scale Automation',
        description: 'Scale automation values by a factor',
        category: 'Automation',
        action: () => {
            const lane = automationStore.value?.lanes[0];
            if (lane) {
                void executeAppAction({ type: 'scaleAutomation', payload: { laneId: lane.id, factor: 1.2 } });
            }
        },
    },
    {
        id: 'invert-automation',
        label: 'Invert Automation',
        description: 'Invert automation values around the center',
        category: 'Automation',
        action: () => {
            const lane = automationStore.value?.lanes[0];
            if (lane) {
                void executeAppAction({ type: 'invertAutomation', payload: { laneId: lane.id } });
            }
        },
    },
    {
        id: 'thin-automation',
        label: 'Thin Automation Points',
        description: 'Reduce automation point density while preserving shape',
        category: 'Automation',
        action: () => {
            const lane = automationStore.value?.lanes[0];
            if (lane) {
                void executeAppAction({ type: 'thinAutomation', payload: { laneId: lane.id } });
            }
        },
    },

    // ── Project ────────────────────────────────────────────────
    {
        id: 'new-project',
        label: 'New Project',
        description: 'Create a new empty project',
        category: 'Project',
        action: () => {
            newProject();
        },
    },
    {
        id: 'save-project',
        label: 'Save Project',
        description: 'Save project to local storage',
        category: 'Project',
        shortcut: '⌘S',
        action: () => {
            saveProject();
        },
    },
    {
        id: 'export-audio',
        label: 'Export Audio',
        description: 'Export mixdown or stems',
        category: 'Project',
        shortcut: '⌘⇧E',
        action: () => {
            document.dispatchEvent(new CustomEvent('webdaw:open-export'));
        },
    },
    {
        id: 'export-project-file',
        label: 'Export Project File',
        description: 'Download project as .webdaw file',
        category: 'Project',
        action: { type: 'exportProject' },
    },
    {
        id: 'import-audio',
        label: 'Import Audio',
        description: 'Import an audio file into the project',
        category: 'Project',
        action: { type: 'importAudioFile' },
    },
    {
        id: 'import-midi',
        label: 'Import MIDI File',
        description: 'Import a Standard MIDI File (.mid)',
        category: 'Project',
        action: { type: 'importMidiFile' },
    },
    {
        id: 'import-project',
        label: 'Import Project',
        description: 'Import a .webdaw project file',
        category: 'Project',
        action: async () => {
            const { pickFiles } = await import('#/modules/Project/useCases/nativeFileDialog');
            const files = await pickFiles({
                filters: [{ name: 'WebDAW Project', extensions: ['webdaw'] }],
                multiple: false,
            });
            if (files && files.length > 0) {
                const { importProjectFile } = await import('#/modules/Project/useCases/projectPersistence');
                await importProjectFile(files[0]!);
            }
        },
    },

    // ── View ───────────────────────────────────────────────────
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
            zoomTimeline(4);
        },
    },
    {
        id: 'zoom-out',
        label: 'Zoom Out',
        description: 'Zoom out of the timeline',
        category: 'View',
        shortcut: '-',
        action: () => {
            zoomTimeline(-4);
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
            const t = transportStore.value;
            if (t) {
                executeAppAction({ type: 'deleteTime', payload: { startBeat: t.loopStart, endBeat: t.loopEnd } });
            }
        },
    },
    {
        id: 'insert-time',
        label: 'Insert Time at Playhead',
        description: 'Insert empty time at the playhead position (4 beats)',
        category: 'Editing',
        action: () => {
            const t = transportStore.value;
            if (t) {
                executeAppAction({ type: 'insertTime', payload: { atBeat: playheadPositionRef.current, durationBeats: 4 } });
            }
        },
    },
    {
        id: 'duplicate-time-range',
        label: 'Duplicate Time Range (Loop Region)',
        description: 'Duplicate the loop region and insert the copy after it',
        category: 'Editing',
        action: () => {
            const t = transportStore.value;
            if (t) {
                executeAppAction({
                    type: 'duplicateTimeRange',
                    payload: { startBeat: t.loopStart, endBeat: t.loopEnd },
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
                void executeAppAction({ type: 'stripSilence', payload: { clipId } });
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

    // ── App ────────────────────────────────────────────────────
    {
        id: 'preferences',
        label: 'Preferences',
        description: 'Open application preferences',
        category: 'App',
        shortcut: '⌘,',
        action: () => {
            document.dispatchEvent(new CustomEvent('webdaw:open-preferences'));
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

    // ── AI Analysis ────────────────────────────────────────────
    {
        id: 'detect-song-structure',
        label: 'Detect Song Structure',
        description: 'Analyze clips and auto-create arrangement sections (intro, verse, chorus, etc.)',
        category: 'AI',
        action: { type: 'detectSongStructure', payload: {} },
    },
    {
        id: 'compare-to-reference',
        label: 'Compare to Reference Mix',
        description: 'Analyze your mix against a mastered reference for actionable feedback',
        category: 'AI',
        action: { type: 'compareToReference' },
    },
    {
        id: 'generate-all-transitions',
        label: 'Generate Transition Fills',
        description: 'Auto-generate drum fills and risers at all section boundaries',
        category: 'AI',
        action: { type: 'generateAllTransitions' },
    },
    {
        id: 'get-mentor-tips',
        label: 'Music Mentor Tips',
        description: 'Get AI feedback explaining why mixing decisions work or need improvement',
        category: 'AI',
        action: { type: 'getMentorTips' },
    },

    // ── Version Control ───────────────────────────────────────
    {
        id: 'create-project-version',
        label: 'Create Project Version',
        description: 'Snapshot the current project state as a version checkpoint',
        category: 'Project',
        action: { type: 'createProjectVersion', payload: { label: 'Manual Checkpoint' } },
    },
    {
        id: 'create-version-branch',
        label: 'Create Version Branch',
        description: 'Create a new branch to experiment with an alternative direction',
        category: 'Project',
        action: { type: 'createVersionBranch', payload: { name: 'Experiment' } },
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
    {
        id: 'toggle-script-editor',
        label: 'Toggle Script Editor',
        description: 'Open the TypeScript scripting console to automate DAW operations',
        category: 'Extension',
        action: { type: 'toggleScriptEditor' },
    },
    {
        id: 'run-script',
        label: 'Run Script',
        description: 'Execute the current script in the editor',
        category: 'Extension',
        action: { type: 'runScript' },
    },

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

    // ── Audio Precision ───────────────────────────────────────
    {
        id: 'set-processing-f64',
        label: 'Enable 64-bit Processing',
        description: 'Switch audio engine to 64-bit (f64) floating-point processing',
        category: 'Audio Engine',
        action: { type: 'setProcessingMode', payload: { mode: 'f64' } },
    },
    {
        id: 'set-processing-f32',
        label: 'Revert to 32-bit Processing',
        description: 'Switch audio engine back to 32-bit (f32) floating-point',
        category: 'Audio Engine',
        action: { type: 'setProcessingMode', payload: { mode: 'f32' } },
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
                void executeAppAction({ type: 'detectTransients', payload: { clipId } });
            }
        },
    },

    // ── Node View ─────────────────────────────────────────────
    {
        id: 'toggle-node-view',
        label: 'Toggle Node-Based Routing',
        description: 'Switch between linear inserts and a Fusion-style node graph view',
        category: 'View',
        action: { type: 'toggleNodeView' },
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

    // ── DAWproject ────────────────────────────────────────────
    {
        id: 'export-dawproject',
        label: 'Export DAWproject',
        description: 'Export project in DAWproject format for Bitwig/Studio One interop',
        category: 'Project',
        action: { type: 'exportDawProject' },
    },

    // ── RAVE ──────────────────────────────────────────────────
    {
        id: 'load-rave-strings',
        label: 'Load RAVE: Strings',
        description: 'Load the orchestral strings neural synthesis model',
        category: 'AI',
        action: { type: 'loadRaveModel', payload: { modelId: 'rave-strings' } },
    },
    {
        id: 'load-rave-vocals',
        label: 'Load RAVE: Vocals',
        description: 'Load the vocal synthesis neural model',
        category: 'AI',
        action: { type: 'loadRaveModel', payload: { modelId: 'rave-vocals' } },
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
                void executeAppAction({ type: 'enableWarping', payload: { clipId } });
            }
        },
    },
    {
        id: 'set-warp-elastique',
        label: 'Set Warp: élastique Pro',
        description: 'Switch the selected clip to élastique Pro stretching algorithm',
        category: 'Editing',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'setWarpAlgorithm', payload: { clipId, algorithm: 'elastique-pro' } });
            }
        },
    },
];

export function fuzzyMatch(query: string, text: string): boolean {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            qi++;
        }
    }
    return qi === q.length;
}

export function searchCommands(query: string): CommandEntry[] {
    if (!query.trim()) {
        return commandRegistry;
    }
    return commandRegistry.filter(
        (cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.description) || fuzzyMatch(query, cmd.category)
    );
}
