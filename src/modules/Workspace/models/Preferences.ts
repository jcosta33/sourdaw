export type GridSnapOption =
    | "bar"
    | "beat"
    | "1/2"
    | "1/4"
    | "1/8"
    | "1/16"
    | "1/32"
    | "1/4T"
    | "1/8T"
    | "1/16T"
    | "1/4D"
    | "1/8D"
    | "off";

export const GRID_SNAP_OPTIONS: { value: GridSnapOption; label: string; beats: number }[] = [
    { value: "bar", label: "Bar", beats: 4 },
    { value: "beat", label: "Beat", beats: 1 },
    { value: "1/2", label: "1/2", beats: 0.5 },
    { value: "1/4", label: "1/4", beats: 0.25 },
    { value: "1/8", label: "1/8", beats: 0.125 },
    { value: "1/16", label: "1/16", beats: 0.0625 },
    { value: "1/32", label: "1/32", beats: 0.03125 },
    { value: "1/4T", label: "1/4T", beats: 1 / 3 },
    { value: "1/8T", label: "1/8T", beats: 1 / 6 },
    { value: "1/16T", label: "1/16T", beats: 1 / 12 },
    { value: "1/4D", label: "1/4D", beats: 0.375 },
    { value: "1/8D", label: "1/8D", beats: 0.1875 },
    { value: "off", label: "Off", beats: 0 },
];

export const gridSnapBeats = (option: GridSnapOption): number => {
    const entry = GRID_SNAP_OPTIONS.find((o) => o.value === option);
    return entry?.beats ?? 0;
};

export type Preferences = {
    trackHeight: "compact" | "normal" | "large";
    colorblindMode: boolean;
    autoSave: boolean;
    autoSaveIntervalMs: number;
    snapToGrid: boolean;
    gridSubdivision: GridSnapOption;
    showMinimap: boolean;
    voiceCommandKey: string;
    theme: "dark" | "light";
};

export const defaultPreferences: Preferences = {
    trackHeight: "normal",
    colorblindMode: false,
    autoSave: true,
    autoSaveIntervalMs: 30_000,
    snapToGrid: true,
    gridSubdivision: "1/4",
    showMinimap: false,
    voiceCommandKey: "v",
    theme: "dark",
};

export const TRACK_HEIGHT_VALUES: Record<Preferences["trackHeight"], number> = {
    compact: 40,
    normal: 64,
    large: 96,
};
