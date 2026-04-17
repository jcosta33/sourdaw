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
        defaultKeys: ['Escape'],
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
    {
        id: 'view.zoomIn',
        label: 'Zoom In',
        category: 'view',
        defaultKeys: ['=', '+'],
        action: { type: 'callback', id: 'zoomIn' },
    },
    {
        id: 'view.zoomOut',
        label: 'Zoom Out',
        category: 'view',
        defaultKeys: ['-'],
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
        defaultKeys: ['mod+shift+a'],
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
    {
        id: 'arrangement.loopFromSelection',
        label: 'Set Loop from Selection',
        category: 'editing',
        defaultKeys: ['mod+l'],
        action: { type: 'callback', id: 'loopFromSelection' },
    },
    {
        id: 'arrangement.deleteTimeRange',
        label: 'Delete Time Range',
        category: 'editing',
        defaultKeys: ['mod+backspace'],
        action: { type: 'callback', id: 'deleteTimeRange' },
    },
    {
        id: 'arrangement.insertSilence',
        label: 'Insert Silence at Selection',
        category: 'editing',
        defaultKeys: ['mod+shift+i'],
        action: { type: 'callback', id: 'insertSilence' },
    },
    {
        id: 'arrangement.duplicateTimeRange',
        label: 'Duplicate Time Range',
        category: 'editing',
        defaultKeys: ['mod+shift+r'],
        action: { type: 'callback', id: 'duplicateTimeRange' },
    },
    {
        id: 'arrangement.cycleGhostClipNext',
        label: 'Select Next Ghost Clip',
        category: 'editing',
        defaultKeys: ['alt+]'],
        action: { type: 'callback', id: 'cycleGhostClipNext' },
    },
    {
        id: 'arrangement.cycleGhostClipPrev',
        label: 'Select Previous Ghost Clip',
        category: 'editing',
        defaultKeys: ['alt+['],
        action: { type: 'callback', id: 'cycleGhostClipPrev' },
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
