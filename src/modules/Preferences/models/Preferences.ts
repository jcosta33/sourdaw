import {
    AUDIO_LATENCY_PROFILES,
    DEFAULT_AUDIO_LATENCY_PROFILE,
    isAudioLatencyProfile,
    type AudioLatencyProfile,
} from '#/infra/audioContext/audioLatencyProfile';
import { TIMELINE_MINIMAP_DEFAULT_HEIGHT } from '#/utils/TimelineMinimap/timelineMinimapHeight';

export { DEFAULT_AUDIO_LATENCY_PROFILE, isAudioLatencyProfile };
export type { AudioLatencyProfile };

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
    // Triplets are two thirds of their straight sibling — three of them fill the
    // span of two. They were twice that, which made every triplet grid *coarser*
    // than the straight option it is named after (1/4T snapped wider than 1/4).
    { value: '1/4T', label: '1/4T', beats: (2 / 3) * 0.25 },
    { value: '1/8T', label: '1/8T', beats: (2 / 3) * 0.125 },
    { value: '1/16T', label: '1/16T', beats: (2 / 3) * 0.0625 },
    { value: '1/4D', label: '1/4D', beats: 0.375 },
    { value: '1/8D', label: '1/8D', beats: 0.1875 },
    { value: 'off', label: 'Off', beats: 0 },
];

export function gridSnapBeats(option: GridSnapOption): number {
    const entry = GRID_SNAP_OPTIONS.find((output) => output.value === option);
    return entry?.beats ?? 0;
}

const AUDIO_LATENCY_PROFILE_LABELS: Record<AudioLatencyProfile, string> = {
    lowLatency: 'Low latency',
    highCapacity: 'High capacity',
};

export const AUDIO_LATENCY_PROFILE_OPTIONS: Array<{ value: AudioLatencyProfile; label: string }> =
    AUDIO_LATENCY_PROFILES.map((value) => ({ value, label: AUDIO_LATENCY_PROFILE_LABELS[value] }));

export type SoloModePreference = 'sip' | 'afl' | 'pfl';

export const AUTO_SAVE_INTERVAL_OPTIONS = [
    { value: 30_000, label: '30 seconds' },
    { value: 60_000, label: '1 minute' },
    { value: 120_000, label: '2 minutes' },
    { value: 300_000, label: '5 minutes' },
] as const;

export type AutoSaveIntervalMs = (typeof AUTO_SAVE_INTERVAL_OPTIONS)[number]['value'];

export function isAutoSaveIntervalMs(value: unknown): value is AutoSaveIntervalMs {
    return AUTO_SAVE_INTERVAL_OPTIONS.some((option) => option.value === value);
}

export const PREFERENCES_SCHEMA_VERSION = 2;

export type Preferences = {
    preferencesSchemaVersion: number;
    trackHeight: 'compact' | 'normal' | 'large';
    colorblindMode: boolean;
    autoSave: boolean;
    autoSaveIntervalMs: AutoSaveIntervalMs;
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
    audioLatencyProfile: AudioLatencyProfile;
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
    audioLatencyProfile: DEFAULT_AUDIO_LATENCY_PROFILE,
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
