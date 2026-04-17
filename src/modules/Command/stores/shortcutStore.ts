import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';
import { type AppAction } from '../useCases/commandQueries';

export type ShortcutAction =
    | { type: 'appAction'; action: AppAction }
    | { type: 'callback'; id: string };

export type ShortcutDefinition = {
    id: string;
    label: string;
    category: 'transport' | 'editing' | 'view' | 'workflow';
    defaultKeys: string[];
    action: ShortcutAction;
};

export type ShortcutStoreState = {
    definitions: ShortcutDefinition[];
    customMappings: Record<string, string[]>;
};

const INITIAL_DEFINITIONS: ShortcutDefinition[] = [
    {
        id: 'transport.togglePlayback',
        label: 'Toggle Playback',
        category: 'transport',
        defaultKeys: ['Space'],
        action: { type: 'appAction', action: { type: 'togglePlayback' } },
    },
    {
        id: 'transport.stopPlayback',
        label: 'Stop Playback / Clear Selection',
        category: 'transport',
        // Escape: context-dependent (clears selection or stops transport — see
        // handleKeydown). Enter: always stops transport (DAW convention).
        defaultKeys: ['Escape', 'Enter'],
        action: { type: 'callback', id: 'stopPlayback' },
    },
    {
        id: 'transport.toggleMetronome',
        label: 'Toggle Metronome',
        category: 'transport',
        defaultKeys: ['m'],
        action: { type: 'appAction', action: { type: 'toggleMetronome' } },
    },
    {
        id: 'transport.toggleRecording',
        label: 'Toggle Recording',
        category: 'transport',
        defaultKeys: ['r'],
        action: { type: 'appAction', action: { type: 'toggleRecording' } },
    },
    {
        id: 'transport.toggleLoop',
        label: 'Toggle Loop',
        category: 'transport',
        defaultKeys: ['l'],
        action: { type: 'appAction', action: { type: 'toggleLoop' } },
    },
    {
        id: 'arrangement.addMidiTrack',
        label: 'Add MIDI Track',
        category: 'workflow',
        defaultKeys: ['n'],
        action: { type: 'appAction', action: { type: 'addTrack', payload: { name: 'MIDI', kind: 'midi' } } },
    },
    {
        id: 'arrangement.addAudioTrack',
        label: 'Add Audio Track',
        category: 'workflow',
        defaultKeys: ['shift+n'],
        action: { type: 'appAction', action: { type: 'addTrack', payload: { name: 'Audio', kind: 'audio' } } },
    },
    // ── Editing ──────────────────────────────────────────────────────────
    {
        id: 'editing.undo',
        label: 'Undo',
        category: 'editing',
        defaultKeys: ['mod+z'],
        action: { type: 'callback', id: 'undo' },
    },
    {
        id: 'editing.redo',
        label: 'Redo',
        category: 'editing',
        defaultKeys: ['mod+shift+z'],
        action: { type: 'callback', id: 'redo' },
    },
    {
        id: 'editing.copyClip',
        label: 'Copy Clip',
        category: 'editing',
        defaultKeys: ['mod+c'],
        action: { type: 'appAction', action: { type: 'copyClip' } },
    },
    {
        id: 'editing.cutClip',
        label: 'Cut Clip',
        category: 'editing',
        defaultKeys: ['mod+x'],
        action: { type: 'appAction', action: { type: 'cutClip' } },
    },
    {
        id: 'editing.pasteClip',
        label: 'Paste Clip',
        category: 'editing',
        defaultKeys: ['mod+v'],
        action: { type: 'appAction', action: { type: 'pasteClip' } },
    },
    {
        id: 'editing.deleteSelection',
        // Marquee-aware: deletes a time-range on selected tracks when a
        // marquee is active, otherwise deletes selected clips with undo.
        label: 'Delete Selection',
        category: 'editing',
        defaultKeys: ['Delete', 'Backspace'],
        action: { type: 'callback', id: 'deleteSelection' },
    },
    // ── Project ──────────────────────────────────────────────────────────
    {
        id: 'project.saveProject',
        label: 'Save Project',
        category: 'workflow',
        defaultKeys: ['mod+s'],
        action: { type: 'appAction', action: { type: 'saveProject' } },
    },
    {
        id: 'project.openExportDialog',
        label: 'Export Audio…',
        category: 'workflow',
        defaultKeys: ['mod+shift+e'],
        action: { type: 'callback', id: 'openExportDialog' },
    },
    {
        id: 'project.openPreferencesDialog',
        label: 'Preferences…',
        category: 'workflow',
        defaultKeys: ['mod+,'],
        action: { type: 'callback', id: 'openPreferencesDialog' },
    },
    // ── Workspace / View ─────────────────────────────────────────────────
    {
        id: 'workspace.toggleSidebar',
        label: 'Toggle Sidebar',
        category: 'view',
        defaultKeys: ['mod+b'],
        action: { type: 'appAction', action: { type: 'toggleSidebar' } },
    },
    {
        id: 'workspace.toggleInspector',
        label: 'Toggle Inspector',
        category: 'view',
        // `alt+i` preserved from the legacy `Workspace/models/Shortcuts.ts`
        // store for users who had muscle memory built up before unification.
        defaultKeys: ['mod+i', 'alt+i'],
        action: { type: 'appAction', action: { type: 'toggleInspector' } },
    },
    {
        id: 'workspace.toggleMixer',
        label: 'Toggle Mixer',
        category: 'view',
        // `alt+m` preserved from the legacy Workspace shortcut store. `m`
        // (without modifier) remains bound to the metronome (see above).
        defaultKeys: ['mod+m', 'alt+m'],
        action: { type: 'callback', id: 'toggleMixer' },
    },
    {
        id: 'workspace.toggleChatPanel',
        label: 'Toggle Chat Panel',
        category: 'view',
        defaultKeys: ['mod+j'],
        action: { type: 'appAction', action: { type: 'toggleChatPanel' } },
    },
    {
        id: 'workspace.toggleTrackList',
        label: 'Toggle Track List',
        category: 'view',
        defaultKeys: ['mod+t'],
        action: { type: 'callback', id: 'toggleTrackList' },
    },
    {
        id: 'workspace.toggleVirtualKeyboard',
        label: 'Toggle Virtual Keyboard',
        category: 'view',
        defaultKeys: ['mod+shift+k'],
        action: { type: 'callback', id: 'toggleVirtualKeyboard' },
    },
    {
        id: 'workspace.showAutomationPanel',
        label: 'Show Automation Panel',
        category: 'view',
        defaultKeys: ['mod+shift+a'],
        action: { type: 'callback', id: 'showAutomationPanel' },
    },
    {
        id: 'view.zoomIn',
        label: 'Zoom In',
        category: 'view',
        // §8.16 — bind `Cmd+=` / `Cmd++` explicitly so the browser's built-in
        // page-zoom shortcut doesn't win. `handleKeydown` returns `true` for
        // the zoom callbacks and `useGlobalKeyboardShortcuts` calls
        // `preventDefault()`, which blocks the browser default.
        defaultKeys: ['mod+=', 'mod++', '=', '+'],
        action: { type: 'callback', id: 'zoomIn' },
    },
    {
        id: 'view.zoomOut',
        label: 'Zoom Out',
        category: 'view',
        defaultKeys: ['mod+-', '-'],
        action: { type: 'callback', id: 'zoomOut' },
    },
    {
        id: 'workspace.toggleCommandPalette',
        label: 'Toggle Command Palette',
        category: 'workflow',
        defaultKeys: ['mod+k'],
        action: { type: 'callback', id: 'toggleCommandPalette' },
    },
    {
        id: 'workspace.selectAllClips',
        label: 'Select All Clips',
        category: 'editing',
        defaultKeys: ['mod+a'],
        action: { type: 'callback', id: 'selectAllClips' },
    },
    {
        id: 'workspace.clearClipSelection',
        label: 'Clear Clip Selection',
        category: 'editing',
        // `Escape` is the sole combo — `mod+shift+a` now belongs to
        // `workspace.showAutomationPanel` (see unification above). The
        // `stopPlayback` callback clears selection first when one is active,
        // so this entry is a convenient alias that goes through the same
        // Escape binding above.
        defaultKeys: ['Escape'],
        action: { type: 'callback', id: 'clearClipSelection' },
    },
    {
        id: 'arrangement.duplicateTrack',
        label: 'Duplicate Track',
        category: 'editing',
        defaultKeys: ['mod+shift+d'],
        action: { type: 'callback', id: 'duplicateTrack' },
    },
    {
        id: 'arrangement.duplicateClip',
        label: 'Duplicate Clip',
        category: 'editing',
        defaultKeys: ['mod+d'],
        action: { type: 'appAction', action: { type: 'duplicateClip', payload: { clipId: 'selected' } } },
    },
    {
        id: 'arrangement.duplicateClipToNextBar',
        label: 'Duplicate Clip to Next Bar',
        category: 'editing',
        defaultKeys: ['alt+d'],
        action: { type: 'appAction', action: { type: 'duplicateClipToNextBar', payload: { clipId: 'selected' } } },
    },
    {
        id: 'view.zoomToFit',
        label: 'Zoom to Fit',
        category: 'view',
        defaultKeys: ['f', 'mod+shift+f'],
        action: { type: 'appAction', action: { type: 'zoomToFit' } },
    },
    {
        id: 'view.zoomToSelection',
        label: 'Zoom to Selection',
        category: 'view',
        defaultKeys: ['F'],
        action: { type: 'appAction', action: { type: 'zoomToSelection' } },
    },
    {
        id: 'view.zoomTracksVerticalIn',
        label: 'Zoom Tracks In',
        category: 'view',
        defaultKeys: ['mod+shift+=', 'mod+shift++'],
        action: { type: 'appAction', action: { type: 'zoomTracksVertical', payload: { delta: 10 } } },
    },
    {
        id: 'view.zoomTracksVerticalOut',
        label: 'Zoom Tracks Out',
        category: 'view',
        defaultKeys: ['mod+shift+-'],
        action: { type: 'appAction', action: { type: 'zoomTracksVertical', payload: { delta: -10 } } },
    },
    {
        id: 'arrangement.clearSolos',
        label: 'Clear All Solos',
        category: 'transport',
        defaultKeys: ['alt+s'],
        action: { type: 'appAction', action: { type: 'clearSolos' } },
    },
    {
        id: 'view.cycleAutomationVisibility',
        label: 'Cycle Automation Visibility',
        category: 'view',
        defaultKeys: ['a'],
        action: { type: 'callback', id: 'cycleAutomationVisibility' },
    },
    {
        id: 'view.toggleWorkspaceMode',
        label: 'Toggle Arrange / Clip Mode',
        category: 'view',
        defaultKeys: ['Tab'],
        action: { type: 'callback', id: 'toggleWorkspaceMode' },
    },
];

const storage = createLocalStorage<ShortcutStoreState>('sourdaw-shortcuts');

function getInitialState(): ShortcutStoreState {
    const stored = storage.get();
    return {
        definitions: INITIAL_DEFINITIONS,
        customMappings: stored?.customMappings ?? {},
    };
}

export const shortcutStore = createStore<ShortcutStoreState>({
    storage,
    initialData: getInitialState(),
});
