import { TIMELINE_MINIMAP_DEFAULT_HEIGHT } from '#/utils/TimelineMinimap/timelineMinimapHeight';

export type GridSnapOption =
    'bar' | 'beat' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/4T' | '1/8T' | '1/16T' | '1/4D' | '1/8D' | 'off';

export const GRID_SNAP_OPTIONS: { value: GridSnapOption; label: string; beats: number }[] = [
    { value: 'bar', label: 'Bar', beats: 4 },
    { value: 'beat', label: 'Beat', beats: 1 },
    { value: '1/2', label: '1/2', beats: 0.5 },
    { value: '1/4', label: '1/4', beats: 0.25 },
    { value: '1/8', label: '1/8', beats: 0.125 },
    { value: '1/16', label: '1/16', beats: 0.0625 },
    { value: '1/32', label: '1/32', beats: 0.03125 },
    { value: '1/4T', label: '1/4T', beats: 1 / 3 },
    { value: '1/8T', label: '1/8T', beats: 1 / 6 },
    { value: '1/16T', label: '1/16T', beats: 1 / 12 },
    { value: '1/4D', label: '1/4D', beats: 0.375 },
    { value: '1/8D', label: '1/8D', beats: 0.1875 },
    { value: 'off', label: 'Off', beats: 0 },
];

export function gridSnapBeats(option: GridSnapOption): number {
    const entry = GRID_SNAP_OPTIONS.find((output) => output.value === option);
    return entry?.beats ?? 0;
}

export type BufferSizeOption = 128 | 256 | 512 | 1024 | 2048;
export type SampleRateOption = 44100 | 48000 | 96000;

export const BUFFER_SIZE_OPTIONS: { value: BufferSizeOption; label: string }[] = [
    { value: 128, label: '128 samples' },
    { value: 256, label: '256 samples' },
    { value: 512, label: '512 samples' },
    { value: 1024, label: '1024 samples' },
    { value: 2048, label: '2048 samples' },
];

export const SAMPLE_RATE_OPTIONS: { value: SampleRateOption; label: string }[] = [
    { value: 44100, label: '44.1 kHz' },
    { value: 48000, label: '48 kHz' },
    { value: 96000, label: '96 kHz' },
];

export type SoloModePreference = 'sip' | 'afl' | 'pfl';

export const PREFERENCES_SCHEMA_VERSION = 1;

export type Preferences = {
    preferencesSchemaVersion: number;
    trackHeight: 'compact' | 'normal' | 'large';
    colorblindMode: boolean;
    autoSave: boolean;
    autoSaveIntervalMs: number;
    snapToGrid: boolean;
    snapToZeroCrossing: boolean;
    gridSubdivision: GridSnapOption;
    showMinimap: boolean;
    timelineMinimapHeight: number;
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

export const defaultPreferences: Preferences = {
    preferencesSchemaVersion: PREFERENCES_SCHEMA_VERSION,
    trackHeight: 'normal',
    colorblindMode: false,
    autoSave: true,
    autoSaveIntervalMs: 30_000,
    snapToGrid: true,
    snapToZeroCrossing: true,
    gridSubdivision: '1/4',
    showMinimap: true,
    timelineMinimapHeight: TIMELINE_MINIMAP_DEFAULT_HEIGHT,
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
