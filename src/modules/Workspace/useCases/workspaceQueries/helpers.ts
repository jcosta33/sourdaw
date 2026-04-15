import {
    type WorkspaceState,
    type WorkspaceMode,
    type SoloMode,
    type ChannelStripWidth,
    type TimeDisplayMode,
    type AutomationVisibility,
    type MarqueeSelection,
} from '../../models/WorkspaceState';
import { type EditingTool } from '../../models/EditingTool';
import {
    type Preferences,
    type GridSnapOption,
    type BufferSizeOption,
    type SampleRateOption,
    type SoloModePreference,
} from '../../models/Preferences';

export type {
    WorkspaceState,
    WorkspaceMode,
    SoloMode,
    ChannelStripWidth,
    TimeDisplayMode,
    AutomationVisibility,
    MarqueeSelection,
    EditingTool,
    Preferences,
    GridSnapOption,
    BufferSizeOption,
    SampleRateOption,
    SoloModePreference,
};

export const defaultPreferences: Preferences = {
    trackHeight: 'normal',
    colorblindMode: false,
    autoSave: true,
    autoSaveIntervalMs: 30_000,
    snapToGrid: true,
    snapToZeroCrossing: true,
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