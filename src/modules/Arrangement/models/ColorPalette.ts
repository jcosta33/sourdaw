/**
 * Canonical OKLCH color palette for the Arrangement module.
 *
 * Every track, clip, marker, and section color should reference these
 * constants so the palette stays in sync across the entire module.
 */

import { MARKER_COLOR_PRESET_VALUES } from '#/utils/markerColorPalette';

// ── Full track palette (12 colors) ──────────────────────────────────

export const TRACK_COLOR_PALETTE = [
    'oklch(0.40 0.08 250)', // deep steel blue
    'oklch(0.38 0.09 20)', // deep coral
    'oklch(0.40 0.08 150)', // deep sage green
    'oklch(0.40 0.08 70)', // deep amber
    'oklch(0.38 0.08 300)', // deep plum
    'oklch(0.38 0.08 340)', // deep rose
    'oklch(0.40 0.07 200)', // deep teal
    'oklch(0.39 0.08 45)', // deep terracotta
    'oklch(0.40 0.07 170)', // deep mint
    'oklch(0.38 0.08 270)', // deep indigo
    'oklch(0.39 0.07 110)', // deep olive
    'oklch(0.38 0.09 0)', // deep brick
] as const;

// ── Section colors (uniform lightness/chroma, varied hue) ───────────

export const SECTION_COLORS = [
    'oklch(0.38 0.08 260)',
    'oklch(0.38 0.08 150)',
    'oklch(0.38 0.08 30)',
    'oklch(0.38 0.08 330)',
    'oklch(0.38 0.08 200)',
    'oklch(0.38 0.08 80)',
] as const;

// ── Marker color presets ────────────────────────────────────────────

export const MARKER_COLOR_PRESETS = MARKER_COLOR_PRESET_VALUES;

// ── Clip color options (empty string = inherit track color) ─────────

export const CLIP_COLOR_OPTIONS = [
    '',
    'oklch(0.40 0.08 250)',
    'oklch(0.38 0.09 20)',
    'oklch(0.40 0.08 150)',
    'oklch(0.40 0.08 70)',
    'oklch(0.38 0.08 300)',
    'oklch(0.38 0.08 340)',
    'oklch(0.40 0.07 200)',
    'oklch(0.39 0.08 45)',
] as const;
