export const MARKER_COLOR_PRESET_VALUES = [
    'oklch(0.40 0.07 200)',
    'oklch(0.40 0.08 150)',
    'oklch(0.40 0.08 70)',
    'oklch(0.38 0.08 340)',
    'oklch(0.38 0.08 270)',
    'oklch(0.38 0.09 20)',
    'oklch(0.40 0.08 250)',
    'oklch(0.39 0.08 45)',
    'oklch(0.38 0.08 300)',
] as const;

const markerColorOptions = [
    { name: 'teal', value: MARKER_COLOR_PRESET_VALUES[0] },
    { name: 'sage', value: MARKER_COLOR_PRESET_VALUES[1] },
    { name: 'amber', value: MARKER_COLOR_PRESET_VALUES[2] },
    { name: 'rose', value: MARKER_COLOR_PRESET_VALUES[3] },
    { name: 'indigo', value: MARKER_COLOR_PRESET_VALUES[4] },
    { name: 'coral', value: MARKER_COLOR_PRESET_VALUES[5] },
    { name: 'blue', value: MARKER_COLOR_PRESET_VALUES[6] },
    { name: 'terracotta', value: MARKER_COLOR_PRESET_VALUES[7] },
    { name: 'plum', value: MARKER_COLOR_PRESET_VALUES[8] },
] as const;

export function getMarkerColorNames(): readonly string[] {
    return markerColorOptions.map((option) => option.name);
}

export function resolveMarkerColorName(value: string): string | null {
    return markerColorOptions.find((option) => option.value === value)?.name ?? null;
}

export function resolveMarkerColorValue(name: string): string | null {
    return markerColorOptions.find((option) => option.name === name)?.value ?? null;
}
