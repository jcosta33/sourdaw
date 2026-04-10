/**
 * Workspace Queries — use case layer exposing Workspace constants
 * and preferences to cross-module consumers.
 */

import { inject } from '#/infra/di/inject';
import { getWorkspaceState as repoGetWorkspaceState } from '../repositories/workspace';

export type GridSnapOption =
    | 'bar'
    | 'beat'
    | '1/2'
    | '1/4'
    | '1/8'
    | '1/16'
    | '1/32'
    | '1/4T'
    | '1/8T'
    | '1/16T'
    | '1/4D'
    | '1/8D'
    | 'off';

export type BufferSizeOption = 128 | 256 | 512 | 1024 | 2048;
export type SampleRateOption = 44100 | 48000 | 96000;
export type SoloModePreference = 'sip' | 'afl' | 'pfl';

export type Preferences = {
    trackHeight: 'compact' | 'normal' | 'large';
    colorblindMode: boolean;
    autoSave: boolean;
    autoSaveIntervalMs: number;
    snapToGrid: boolean;
    gridSubdivision: GridSnapOption;
    showMinimap: boolean;
    voiceCommandKey: string;
    theme: 'dark' | 'light';
    uiScale: number;
    panelPlacementSidebar: 'left' | 'right';
    panelPlacementInspector: 'left' | 'right';
    panelPlacementChat: 'left' | 'right';
    panelPlacementAi: 'left' | 'right';
    bufferSize: BufferSizeOption;
    sampleRate: SampleRateOption;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    recordCountIn: 0 | 1 | 2 | 4;
    defaultVelocity: number;
    midiInputChannel: number | 'all';
    soloMode: SoloModePreference;
    preRollEnabled: boolean;
    preRollBars: 1 | 2 | 4;
};

export type EditingTool = 'select' | 'cut' | 'draw' | 'automation' | 'stretch';

export type WorkspaceMode = 'arrange' | 'automation' | 'clip';
export type SoloMode = 'sip' | 'afl' | 'pfl';
export type ChannelStripWidth = 'narrow' | 'normal' | 'wide';
export type TimeDisplayMode = 'musical' | 'time';
export type AutomationVisibility = 'hidden' | 'overlay' | 'panel';

export type WorkspaceState = {
    mode: WorkspaceMode;
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    mixerOpen: boolean;
    automationPanelOpen: boolean;
    automationPanelWidth: number;
    trackListOpen: boolean;
    trackListWidth: number;
    activeTool: EditingTool;
    commandPaletteOpen: boolean;
    selectedClipId: string | null;
    selectedClipIds: string[];
    snapValue: number;
    sidebarWidth: number;
    inspectorWidth: number;
    mixerHeight: number;
    soloMode: SoloMode;
    channelStripWidth: ChannelStripWidth;
    timeDisplayMode: TimeDisplayMode;
    undoHistoryOpen: boolean;
    collaborationPanelOpen: boolean;
    branchManagerOpen: boolean;
    chatPanelOpen: boolean;
    chatPanelWidth: number;
    rippleEditing: boolean;
    automationVisibility: AutomationVisibility;
    automationSubLanes: Record<string, string[]>;
    scratchPadOpen: boolean;
    scratchPadHeight: number;
    aiPanelWidth: number;
    fermenterHeight: number;
    toasterHeight: number;
    levainHeight: number;
    glutenHeight: number;
    bacteriaHeight: number;
    grinderHeight: number;
    proofChamberHeight: number;
    proofHeight: number;
    scoringHeight: number;
    yeastHeight: number;
    crustHeight: number;
    samplerHeight: number;
    grandBouleHeight: number;
    virtualKeyboardOpen: boolean;
    virtualKeyboardOctave: number;
    virtualKeyboardHeight: number;
    virtualKeyboardVelocity: number;
};

const GRID_SNAP_OPTIONS: ReadonlyArray<{ value: GridSnapOption; beats: number }> = [
    { value: 'bar', beats: 4 },
    { value: 'beat', beats: 1 },
    { value: '1/2', beats: 0.5 },
    { value: '1/4', beats: 0.25 },
    { value: '1/8', beats: 0.125 },
    { value: '1/16', beats: 0.0625 },
    { value: '1/32', beats: 0.03125 },
    { value: '1/4T', beats: 1 / 3 },
    { value: '1/8T', beats: 1 / 6 },
    { value: '1/16T', beats: 1 / 12 },
    { value: '1/4D', beats: 0.375 },
    { value: '1/8D', beats: 0.1875 },
    { value: 'off', beats: 0 },
];

export function gridSnapBeats(option: GridSnapOption): number {
    const entry = GRID_SNAP_OPTIONS.find((gridOption) => gridOption.value === option);
    return entry?.beats ?? 0;
}

export const defaultPreferences: Preferences = {
    trackHeight: 'normal',
    colorblindMode: false,
    autoSave: true,
    autoSaveIntervalMs: 30_000,
    snapToGrid: true,
    gridSubdivision: '1/4',
    showMinimap: false,
    voiceCommandKey: 'v',
    theme: 'dark',
    uiScale: 1.0,
    panelPlacementSidebar: 'left',
    panelPlacementInspector: 'right',
    panelPlacementChat: 'right',
    panelPlacementAi: 'right',
    bufferSize: 512,
    sampleRate: 44100,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    recordCountIn: 1,
    defaultVelocity: 100,
    midiInputChannel: 'all',
    soloMode: 'sip',
    preRollEnabled: false,
    preRollBars: 2,
};



export const TRACK_HEIGHT_VALUES: Record<Preferences['trackHeight'], number> = {
    compact: 40,
    normal: 64,
    large: 96,
};

export const TOOL_SHORTCUTS: Record<string, EditingTool> = {
    s: 'select',
    c: 'cut',
    d: 'draw',
    b: 'draw',
    t: 'stretch',
};

export const getWorkspaceState = inject({ repoGetWorkspaceState })(
    ({ repoGetWorkspaceState }) =>
        function getWorkspaceState(): WorkspaceState | null {
            return repoGetWorkspaceState();
        }
);
