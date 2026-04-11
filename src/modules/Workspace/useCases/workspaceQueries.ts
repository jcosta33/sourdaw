import { getWorkspaceState as repoGetWorkspaceState } from '../repositories/workspace';
import {
    type WorkspaceState,
    type WorkspaceMode,
    type SoloMode,
    type ChannelStripWidth,
    type TimeDisplayMode,
    type AutomationVisibility,
} from '../models/WorkspaceState';
import { type EditingTool } from '../models/EditingTool';
import { type Preferences, type GridSnapOption, type BufferSizeOption, type SampleRateOption, type SoloModePreference } from '../models/Preferences';

export type {
    WorkspaceState,
    WorkspaceMode,
    SoloMode,
    ChannelStripWidth,
    TimeDisplayMode,
    AutomationVisibility,
    EditingTool,
    Preferences,
    GridSnapOption,
    BufferSizeOption,
    SampleRateOption,
    SoloModePreference,
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

export function getWorkspaceState(): WorkspaceState | null {
    return repoGetWorkspaceState();
}
