import { describe, expect, it } from 'vitest';

import {
    CLIP_LABEL_ASCENT_CSS_PX,
    CLIP_LABEL_BLOCK_HEIGHT_CSS_PX,
    CLIP_LABEL_DESCENT_CSS_PX,
    computeClipLabelLayout,
} from '../clipLabel';

// This layout is the single contract the Canvas2D and WebGPU timeline backends
// both draw clip names from. The numbers below are the ones the Canvas renderer
// has always used (`fillText(name, x + 6, trackY + 14, w - 12)`); pinning them
// here is what stops the two backends drifting into different-looking labels.
describe('computeClipLabelLayout', () => {
    it('insets the name from the clip edge and puts the baseline below the track top', () => {
        const layout = computeClipLabelLayout({ clipXCssPx: 200, clipWidthCssPx: 100, trackYCssPx: 48 });

        expect(layout.visible).toBe(true);
        expect(layout.xCssPx).toBe(206);
        expect(layout.baselineYCssPx).toBe(62);
        expect(layout.maxWidthCssPx).toBe(88);
    });

    it('tracks the clip as it scrolls, rather than pinning the name to the viewport', () => {
        const onscreen = computeClipLabelLayout({ clipXCssPx: 200, clipWidthCssPx: 100, trackYCssPx: 0 });
        const scrolledLeft = computeClipLabelLayout({ clipXCssPx: -40, clipWidthCssPx: 100, trackYCssPx: 0 });

        expect(onscreen.xCssPx).toBe(206);
        expect(scrolledLeft.xCssPx).toBe(-34);
    });

    it('reserves descender room below the baseline in the label block', () => {
        const layout = computeClipLabelLayout({ clipXCssPx: 0, clipWidthCssPx: 100, trackYCssPx: 48 });

        expect(layout.blockTopYCssPx).toBe(layout.baselineYCssPx - CLIP_LABEL_ASCENT_CSS_PX);
        expect(layout.blockTopYCssPx + CLIP_LABEL_BLOCK_HEIGHT_CSS_PX).toBe(
            layout.baselineYCssPx + CLIP_LABEL_DESCENT_CSS_PX
        );
    });

    it('condenses the name into the shrinking clip as zoom decreases', () => {
        const wide = computeClipLabelLayout({ clipXCssPx: 0, clipWidthCssPx: 200, trackYCssPx: 0 });
        const narrow = computeClipLabelLayout({ clipXCssPx: 0, clipWidthCssPx: 40, trackYCssPx: 0 });

        expect(wide.maxWidthCssPx).toBe(188);
        expect(narrow.maxWidthCssPx).toBe(28);
        expect(narrow.visible).toBe(true);
    });

    it('reports the name invisible once the clip is narrower than its own insets', () => {
        // A non-positive `maxWidth` makes Canvas2D's `fillText` paint nothing,
        // so both backends must agree there is no label to draw at this width.
        expect(computeClipLabelLayout({ clipXCssPx: 0, clipWidthCssPx: 12, trackYCssPx: 0 }).visible).toBe(false);
        expect(computeClipLabelLayout({ clipXCssPx: 0, clipWidthCssPx: 4, trackYCssPx: 0 }).visible).toBe(false);
        expect(computeClipLabelLayout({ clipXCssPx: 0, clipWidthCssPx: 13, trackYCssPx: 0 }).visible).toBe(true);
    });
});
