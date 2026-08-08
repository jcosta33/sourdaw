/**
 * Clip name rasterisation for the WebGPU timeline renderer.
 *
 * WebGPU has no text primitive. The conventional route is to rasterise the
 * string with a 2D context and upload the result as a texture, which is what
 * this cache does: one `OffscreenCanvas` `fillText` per distinct label, one
 * `GPUTexture` and one bind group held for as long as that label keeps being
 * asked for.
 *
 * Rasterising is far too expensive to redo per frame, so entries are keyed by
 * everything that can change the pixels — the string, the condensed width
 * (which moves with zoom) and the device pixel ratio. A label whose text or
 * zoom changed therefore misses the cache and is redrawn; an unchanged one is
 * reused.
 *
 * ## Why the open frame's entries are pinned
 *
 * The caller collects a frame's bind groups while it walks the clips and only
 * encodes them into the render pass once that walk is done. A texture destroyed
 * part-way through the walk is therefore destroyed while a bind group naming it
 * is already committed to the frame — and WebGPU rejects the *entire* command
 * buffer at submit, not just that one label. A frame with more distinct labels
 * than the cache retained used to be a black timeline, every frame.
 *
 * One rule makes that unrepresentable, and it holds whatever the retention
 * bound is set to: **an entry acquired since the last `endFrame` is pinned**
 * and can never be chosen as an eviction victim. A frame that asks for more
 * distinct labels than the cache retains overshoots the bound for the duration
 * of that frame and hands the excess back at `endFrame`, rather than destroying
 * something the frame is drawing with.
 *
 * Raising the retention bound alone would not have fixed this: it moves the
 * cliff without removing it, and any later change to the caller's per-frame
 * label budget would walk straight back off it.
 */

import {
    CLIP_LABEL_ASCENT_CSS_PX,
    CLIP_LABEL_BLOCK_HEIGHT_CSS_PX,
    CLIP_LABEL_DESCENT_CSS_PX,
    CLIP_LABEL_FILL_STYLE,
    CLIP_LABEL_FONT,
} from './clipLabel';

export type ClipLabelTexture = {
    /** Bound at group 0 of the text pipeline before drawing the label's quad. */
    bindGroup: GPUBindGroup;
    /**
     * Raster width in **device** px — always a whole number of texels.
     *
     * The caller must size the textured quad from this, not from the clip's
     * width and not from a CSS-px value it scales itself. Sizing from the clip
     * stretches a short name across the whole clip; sizing from a CSS-px value
     * lands the quad a fraction of a device pixel away from the texel grid,
     * which the `linear` sampler resolves as a blur that shimmers as the
     * timeline scrolls.
     */
    widthDevicePx: number;
    /** Raster height in device px — a whole number of texels, as above. */
    heightDevicePx: number;
    /**
     * Device-px offset from the label's pen position to the raster's top-left
     * corner. Zero for a plain Latin run; negative when the glyphs' ink
     * overhangs the pen — an italic's left side bearing, an emoji or a stacked
     * diacritic reaching above the block's nominal ascent.
     *
     * Always whole numbers, so a caller that rounds the pen position keeps the
     * quad on the texel grid.
     */
    offsetXDevicePx: number;
    offsetYDevicePx: number;
};

export type AcquireClipLabelInput = {
    /** The clip name to draw. */
    text: string;
    /** Width the glyph run is condensed into, in CSS px. */
    maxWidthCssPx: number;
    /** Backing-store scale, so the raster is sharp on HiDPI displays. */
    dpr: number;
};

export type ClipLabelTextureCache = {
    /** Rasterise (or reuse) `text` and return its bind group, or null if unrenderable. */
    acquire: (input: AcquireClipLabelInput) => ClipLabelTexture | null;
    /**
     * Close the frame the acquires belong to: unpin them and evict back down to
     * the retention bound.
     *
     * Call this *after* submitting the frame's command buffer. Unpinning is
     * what makes the frame's own entries evictable, and destroying one is only
     * legal once the command buffer using it has been submitted.
     */
    endFrame: () => void;
    /** Destroy every held texture. */
    dispose: () => void;
};

export type CreateClipLabelTextureCacheInput = {
    device: GPUDevice;
    /** Layout of the text pipeline's group 0 (sampler + texture). */
    bindGroupLayout: GPUBindGroupLayout;
    sampler: GPUSampler;
    /**
     * Distinct labels retained *between* frames.
     *
     * Set this to at least the caller's per-frame label budget or every frame
     * throws away work the next frame immediately redoes. It is a retention
     * bound, not a safety bound: a frame that exceeds it is still rendered
     * correctly, just less cheaply.
     */
    maxCachedLabels: number;
};

type CacheEntry = {
    texture: GPUTexture;
    bindGroup: GPUBindGroup;
    widthDevicePx: number;
    heightDevicePx: number;
    offsetXDevicePx: number;
    offsetYDevicePx: number;
};

/**
 * What the 2D context can tell us about a glyph run. The ink fields are null
 * when the engine does not report them, in which case the raster falls back to
 * the advance width and the nominal ascent/descent block.
 */
type LabelMetrics = {
    /** Pen advance — how far the cursor moves, which is *not* the inked extent. */
    advanceCssPx: number;
    inkLeftCssPx: number | null;
    inkRightCssPx: number | null;
    inkAscentCssPx: number | null;
    inkDescentCssPx: number | null;
};

/** A `TextMetrics` field is only usable when the engine reported a real number. */
function reportedOrNull(value: number | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return null;
}

export function createClipLabelTextureCache({
    device,
    bindGroupLayout,
    sampler,
    maxCachedLabels,
}: CreateClipLabelTextureCacheInput): ClipLabelTextureCache {
    // Insertion order doubles as recency: a hit is deleted and re-set so the
    // oldest key is always the first one Map iteration yields.
    const entries = new Map<string, CacheEntry>();

    // Keys acquired since the last `endFrame`. Eviction may not touch these —
    // their bind groups are already committed to the frame being built.
    const pinnedThisFrame = new Set<string>();

    // One 1x1 scratch context, kept for the cache's lifetime, purely to measure
    // glyph runs before deciding how large the real raster needs to be. Its own
    // size is irrelevant — `measureText` reads the font, not the backing store —
    // and reusing it avoids allocating a canvas per measurement.
    let measuringContext: OffscreenCanvasRenderingContext2D | null | undefined;

    function measureLabel(text: string): LabelMetrics {
        if (measuringContext === undefined) {
            measuringContext = new OffscreenCanvas(1, 1).getContext('2d');
            if (measuringContext) {
                measuringContext.font = CLIP_LABEL_FONT;
            }
        }
        if (!measuringContext) {
            // No 2D context to measure with. Fall back to the caller's bound,
            // which is the pre-existing behaviour: correct, merely wasteful.
            return {
                advanceCssPx: Number.POSITIVE_INFINITY,
                inkLeftCssPx: null,
                inkRightCssPx: null,
                inkAscentCssPx: null,
                inkDescentCssPx: null,
            };
        }
        const metrics = measuringContext.measureText(text);
        return {
            advanceCssPx: metrics.width,
            inkLeftCssPx: reportedOrNull(metrics.actualBoundingBoxLeft),
            inkRightCssPx: reportedOrNull(metrics.actualBoundingBoxRight),
            inkAscentCssPx: reportedOrNull(metrics.actualBoundingBoxAscent),
            inkDescentCssPx: reportedOrNull(metrics.actualBoundingBoxDescent),
        };
    }

    function rasterise(text: string, maxWidthCssPx: number, dpr: number): CacheEntry | null {
        if (typeof OffscreenCanvas === 'undefined') {
            return null;
        }

        // Size the raster to the glyph run, not to the clip. `maxWidthCssPx` is
        // the clip's drawn width, which grows without limit as the user zooms —
        // a 3-minute clip at editing zoom is thousands of CSS px wide, and at
        // dpr 2 that asks for a texture past the default `maxTextureDimension2D`
        // of 8192, which is a validation error and a silently missing label.
        // The text needs no more than it occupies, so measure it first.
        //
        // `measureText` runs under the same `scale(dpr, dpr)` the draw does, so
        // its result is already CSS px.
        const metrics = measureLabel(text);
        const deviceCeilingCssPx = device.limits.maxTextureDimension2D / dpr;
        const usedWidthCssPx = Math.min(metrics.advanceCssPx, maxWidthCssPx, deviceCeilingCssPx);

        // `fillText`'s `maxWidth` condenses the run horizontally rather than
        // clipping it, so the ink squeezes by the same factor the advance does.
        let condense = 1;
        if (
            Number.isFinite(metrics.advanceCssPx) &&
            metrics.advanceCssPx > usedWidthCssPx &&
            metrics.advanceCssPx > 0
        ) {
            condense = usedWidthCssPx / metrics.advanceCssPx;
        }

        // The advance width is where the *pen* ends up, not where the ink does.
        // An italic's final glyph leans past it, an emoji is drawn wider than it
        // advances, and several scripts carry marks outside it on either side —
        // all of which a raster cut to the advance shears off. Where the engine
        // reports the ink box, size to that instead.
        const inkLeftCssPx = Math.max(0, (metrics.inkLeftCssPx ?? 0) * condense);
        const inkRightCssPx = metrics.inkRightCssPx === null ? usedWidthCssPx : metrics.inkRightCssPx * condense;
        const inkAscentCssPx = metrics.inkAscentCssPx ?? CLIP_LABEL_ASCENT_CSS_PX;
        const inkDescentCssPx = metrics.inkDescentCssPx ?? CLIP_LABEL_DESCENT_CSS_PX;

        // Padding is quantised to whole device px *first*, then converted back
        // to CSS px for the draw. Rounding the other way round would leave the
        // glyphs a fraction of a texel off the offset the caller is handed.
        const padLeftDevicePx = Math.ceil(inkLeftCssPx * dpr);
        const padTopDevicePx = Math.ceil(Math.max(0, inkAscentCssPx - CLIP_LABEL_ASCENT_CSS_PX) * dpr);
        const padBottomDevicePx = Math.ceil(Math.max(0, inkDescentCssPx - CLIP_LABEL_DESCENT_CSS_PX) * dpr);
        const padLeftCssPx = padLeftDevicePx / dpr;
        const padTopCssPx = padTopDevicePx / dpr;

        const limit = device.limits.maxTextureDimension2D;
        const contentWidthCssPx = Math.min(Math.max(usedWidthCssPx, inkRightCssPx), deviceCeilingCssPx);
        const widthDevicePx = Math.min(limit, Math.max(1, padLeftDevicePx + Math.ceil(contentWidthCssPx * dpr)));
        const heightDevicePx = Math.min(
            limit,
            Math.max(1, padTopDevicePx + Math.ceil(CLIP_LABEL_BLOCK_HEIGHT_CSS_PX * dpr) + padBottomDevicePx)
        );

        const offscreen = new OffscreenCanvas(widthDevicePx, heightDevicePx);
        const context = offscreen.getContext('2d');
        if (!context) {
            return null;
        }

        // Work in CSS px so the typography constants read the same here as they
        // do in the Canvas2D renderer.
        context.scale(dpr, dpr);
        context.font = CLIP_LABEL_FONT;
        context.textBaseline = 'alphabetic';
        context.fillStyle = CLIP_LABEL_FILL_STYLE;
        context.fillText(text, padLeftCssPx, padTopCssPx + CLIP_LABEL_ASCENT_CSS_PX, usedWidthCssPx);

        const texture = device.createTexture({
            size: { width: widthDevicePx, height: heightDevicePx },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        device.queue.copyExternalImageToTexture(
            { source: offscreen },
            // The canvas holds straight alpha; ask the copy to premultiply so it
            // matches the premultiplied blend the render pipeline uses.
            { texture, premultipliedAlpha: true },
            { width: widthDevicePx, height: heightDevicePx }
        );

        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: texture.createView() },
            ],
        });

        return {
            texture,
            bindGroup,
            widthDevicePx,
            heightDevicePx,
            // Subtracted from zero rather than negated: `-0` is a distinct
            // value under `Object.is`, and the common case (no overhang) would
            // otherwise hand every caller a negative zero.
            offsetXDevicePx: 0 - padLeftDevicePx,
            offsetYDevicePx: 0 - padTopDevicePx,
        };
    }

    /**
     * Evict back towards the retention bound, skipping anything the open frame
     * has already handed out.
     *
     * Destroying here is safe *because* of that skip, and only because of it: a
     * victim the open frame never asked for has no bind group queued in the
     * frame being built, and a command buffer that already went to `submit`
     * keeps its textures alive until the GPU is done with them. Take the skip
     * away and this line destroys a texture the current frame is drawing with.
     */
    function evictUnpinned(): void {
        if (entries.size <= maxCachedLabels) {
            return;
        }
        for (const [key, entry] of entries) {
            if (entries.size <= maxCachedLabels) {
                return;
            }
            if (pinnedThisFrame.has(key)) {
                continue;
            }
            entries.delete(key);
            entry.texture.destroy();
        }
    }

    function toPublic(entry: CacheEntry): ClipLabelTexture {
        return {
            bindGroup: entry.bindGroup,
            widthDevicePx: entry.widthDevicePx,
            heightDevicePx: entry.heightDevicePx,
            offsetXDevicePx: entry.offsetXDevicePx,
            offsetYDevicePx: entry.offsetYDevicePx,
        };
    }

    return {
        acquire({ text, maxWidthCssPx, dpr }: AcquireClipLabelInput): ClipLabelTexture | null {
            if (text.length === 0 || maxWidthCssPx <= 0) {
                return null;
            }

            // Quantise the width so sub-pixel zoom jitter does not rasterise a
            // fresh texture on every frame of a drag. The delimiter matters:
            // concatenating the three parts raw makes dpr 1 / width 23 / "foo"
            // and dpr 1 / width 2 / "3foo" the same key, which serves one clip
            // the other's raster. NUL is the delimiter because it is the one
            // character a clip name cannot smuggle past the name field.
            const quantisedWidth = Math.round(maxWidthCssPx);
            const key = `${dpr}\u0000${quantisedWidth}\u0000${text}`;

            const cached = entries.get(key);
            if (cached) {
                entries.delete(key);
                entries.set(key, cached);
                pinnedThisFrame.add(key);
                return toPublic(cached);
            }

            const created = rasterise(text, quantisedWidth, dpr);
            if (!created) {
                return null;
            }

            entries.set(key, created);
            pinnedThisFrame.add(key);
            evictUnpinned();
            return toPublic(created);
        },

        endFrame(): void {
            pinnedThisFrame.clear();
            // Nothing is pinned now, so a frame that overshot the bound gives
            // its excess back here rather than carrying it forever.
            evictUnpinned();
        },

        dispose(): void {
            for (const entry of entries.values()) {
                entry.texture.destroy();
            }
            entries.clear();
            pinnedThisFrame.clear();
        },
    };
}
