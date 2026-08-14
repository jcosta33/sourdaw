import { MARKER_COLOR_PRESETS, SECTION_COLORS } from './ColorPalette';

export type Marker = {
    id: string;
    beat: number;
    name: string;
    color: string;
};

export type ArrangementSection = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
};

export function createMarker(beat: number, name: string): Marker {
    return {
        // F9: the full UUID, not a truncated 8-hex-char prefix — truncating
        // invited birthday collisions for `clipIdCounter.ts`, and a warp
        // marker id is on the same busy-session path.
        id: `marker-${crypto.randomUUID()}`,
        beat,
        name,
        // F14: sourced from the shared palette, not a private duplicate literal.
        color: MARKER_COLOR_PRESETS[0],
    };
}

export function createSection(startBeat: number, endBeat: number, name: string): ArrangementSection {
    return {
        id: `section-${crypto.randomUUID()}`,
        startBeat,
        endBeat,
        name,
        color: SECTION_COLORS[0],
    };
}
