export const TIMELINE_MINIMAP_MIN_HEIGHT = 28;
export const TIMELINE_MINIMAP_DEFAULT_HEIGHT = TIMELINE_MINIMAP_MIN_HEIGHT;
export const TIMELINE_MINIMAP_MAX_HEIGHT = 160;

export function normalizeTimelineMinimapHeight(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return TIMELINE_MINIMAP_DEFAULT_HEIGHT;
    }

    const rounded = Math.round(value);
    if (rounded < TIMELINE_MINIMAP_MIN_HEIGHT) {
        return TIMELINE_MINIMAP_MIN_HEIGHT;
    }
    if (rounded > TIMELINE_MINIMAP_MAX_HEIGHT) {
        return TIMELINE_MINIMAP_MAX_HEIGHT;
    }
    return rounded;
}
