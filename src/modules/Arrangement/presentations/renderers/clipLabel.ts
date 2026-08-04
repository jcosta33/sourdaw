/**
 * Clip name label typography and placement.
 *
 * Both timeline backends draw the clip name from these values so a user
 * switching renderers reads the same thing in the same place. The Canvas2D
 * renderer (`clipDrawing.ts`) has always drawn the name with
 * `fillText(clip.name, x + 6, trackY + 14, w - 12)`; those three numbers are
 * the inset, the baseline and the twice-inset squeeze budget below, and the
 * WebGPU renderer rasterises against the same layout.
 *
 * Truncation rule: none. Canvas2D's `maxWidth` argument *condenses* the glyph
 * run to fit rather than clipping or ellipsising it, and a clip narrower than
 * the inset pair draws nothing at all (per the 2D spec, a non-positive
 * `maxWidth` makes `fillText` return without painting). The label is placed
 * relative to the clip's own left edge, so it scrolls out of view with the clip
 * rather than staying pinned to the viewport.
 */

/** Weight/size/family of the clip name, in Canvas 2D shorthand font syntax. */
export const CLIP_LABEL_FONT = '500 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

/** Fill colour of the clip name. */
export const CLIP_LABEL_FILL_STYLE = 'rgba(255, 255, 255, 0.92)';

/** Horizontal gap between the clip's left edge and the first glyph, in CSS px. */
export const CLIP_LABEL_INSET_CSS_PX = 6;

/** Text baseline offset from the track's top edge, in CSS px. */
export const CLIP_LABEL_BASELINE_CSS_PX = 14;

/** Space above the baseline the tallest glyph can occupy, in CSS px. */
export const CLIP_LABEL_ASCENT_CSS_PX = 10;

/** Space below the baseline a descender can occupy, in CSS px. */
export const CLIP_LABEL_DESCENT_CSS_PX = 4;

/** Total vertical extent a rasterised label needs, in CSS px. */
export const CLIP_LABEL_BLOCK_HEIGHT_CSS_PX = CLIP_LABEL_ASCENT_CSS_PX + CLIP_LABEL_DESCENT_CSS_PX;

export type ClipLabelLayout = {
    /** False when the clip is too narrow to paint any glyphs. */
    visible: boolean;
    /** Left edge of the glyph run, in CSS px. */
    xCssPx: number;
    /** Text baseline, in CSS px. */
    baselineYCssPx: number;
    /** Top edge of the label's bounding block, in CSS px. */
    blockTopYCssPx: number;
    /** Width the glyph run is condensed into, in CSS px. Non-positive means invisible. */
    maxWidthCssPx: number;
};

export type ComputeClipLabelLayoutInput = {
    /** The clip's left edge in the timeline, in CSS px. */
    clipXCssPx: number;
    /** The clip's full drawn width, in CSS px. */
    clipWidthCssPx: number;
    /** The track row's top edge, in CSS px. */
    trackYCssPx: number;
};

/**
 * Place a clip's name label. Pure so both renderers — and their specs — can
 * agree on the geometry without a canvas or a GPU device.
 */
export function computeClipLabelLayout({
    clipXCssPx,
    clipWidthCssPx,
    trackYCssPx,
}: ComputeClipLabelLayoutInput): ClipLabelLayout {
    const maxWidthCssPx = clipWidthCssPx - CLIP_LABEL_INSET_CSS_PX * 2;
    return {
        visible: maxWidthCssPx > 0,
        xCssPx: clipXCssPx + CLIP_LABEL_INSET_CSS_PX,
        baselineYCssPx: trackYCssPx + CLIP_LABEL_BASELINE_CSS_PX,
        blockTopYCssPx: trackYCssPx + CLIP_LABEL_BASELINE_CSS_PX - CLIP_LABEL_ASCENT_CSS_PX,
        maxWidthCssPx,
    };
}
