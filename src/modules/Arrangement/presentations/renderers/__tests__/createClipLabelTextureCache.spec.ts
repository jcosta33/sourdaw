import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIP_LABEL_BLOCK_HEIGHT_CSS_PX } from '../clipLabel';
import { createClipLabelTextureCache } from '../createClipLabelTextureCache';

/**
 * jsdom has no `OffscreenCanvas`. The cache measures glyph runs on a 1x1 2D
 * context, then rasterises into a second OffscreenCanvas whose pixels are
 * uploaded as a GPU texture. The stub records both `measureText` and
 * `fillText` calls so the spec can assert the exact width budget the cache
 * asks the 2D context to condense the glyph run into.
 */
type LabelContext = {
    measureText: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    scale: ReturnType<typeof vi.fn>;
    font: string;
    textBaseline: string;
    fillStyle: string;
};

/**
 * What the stubbed 2D context reports for a glyph run. `width` is the pen
 * advance; the `actualBoundingBox*` fields are the ink box, which real engines
 * report and which can extend outside the advance in every direction.
 */
type StubTextMetrics = {
    width: number;
    actualBoundingBoxLeft?: number;
    actualBoundingBoxRight?: number;
    actualBoundingBoxAscent?: number;
    actualBoundingBoxDescent?: number;
};

function install_offscreen_canvas_stub(measured: () => StubTextMetrics): {
    contexts: LabelContext[];
    fillTextAll: ReturnType<typeof vi.fn>;
    canvasSizes: { width: number; height: number }[];
} {
    const contexts: LabelContext[] = [];
    const canvasSizes: { width: number; height: number }[] = [];
    const fillTextAll = vi.fn();
    class OffscreenCanvasStub {
        width: number;
        height: number;

        constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
            canvasSizes.push({ width, height });
        }

        getContext(contextId: string): LabelContext | null {
            if (contextId !== '2d') {
                return null;
            }
            const ctx: LabelContext = {
                measureText: vi.fn(() => measured()),
                fillText: fillTextAll,
                scale: vi.fn(),
                font: '',
                textBaseline: '',
                fillStyle: '',
            };
            // Each rasterise step touches its own context, but the 1x1 measuring
            // context is created lazily and shared. Capture every instance so the
            // spec can assert font/fillStyle settings on whichever context the
            // cache actually painted to.
            contexts.push(ctx);
            return ctx;
        }
    }
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasStub);
    return { contexts, fillTextAll, canvasSizes };
}

type StubDevice = {
    limits: { maxTextureDimension2D: number };
    createTexture: ReturnType<typeof vi.fn>;
    createBindGroup: ReturnType<typeof vi.fn>;
    queue: { copyExternalImageToTexture: ReturnType<typeof vi.fn> };
};

type DeviceHandles = {
    device: StubDevice;
    destroyedTextures: string[];
    bindGroups: string[];
    sampler: GPUSampler;
    bindGroupLayout: GPUBindGroupLayout;
};

function install_device_stub(): DeviceHandles {
    const destroyedTextures: string[] = [];
    const bindGroups: string[] = [];
    let textureSeq = 0;
    let bindGroupSeq = 0;
    const createTexture = vi.fn(() => {
        const id = `tex-${(textureSeq += 1)}`;
        return {
            id,
            createView: vi.fn(() => ({ id: `view-${id}` })),
            destroy: vi.fn(() => {
                destroyedTextures.push(id);
            }),
        };
    });
    const createBindGroup = vi.fn(() => {
        const id = `bg-${(bindGroupSeq += 1)}`;
        bindGroups.push(id);
        return { id };
    });
    const device = {
        limits: { maxTextureDimension2D: 8192 },
        createTexture,
        createBindGroup,
        queue: {
            copyExternalImageToTexture: vi.fn(),
        },
    };
    return {
        device,
        destroyedTextures,
        bindGroups,
        // Branded WebGPU types — the device stub never touches their real shape;
        // they are passed straight through to createBindGroup.
        sampler: { id: 'sampler' } as unknown as GPUSampler,
        bindGroupLayout: { id: 'bgl' } as unknown as GPUBindGroupLayout,
    };
}

describe('createClipLabelTextureCache', () => {
    let handles: DeviceHandles;

    beforeEach(() => {
        handles = install_device_stub();
        // The measuring context reports a 30px glyph run by default — narrow
        // enough that the clip budget only constrains it when the test shrinks
        // the run, wide enough to exercise `Math.min(measured, budget, ceiling)`.
        install_offscreen_canvas_stub(() => ({ width: 30 }));
        vi.stubGlobal('GPUTextureUsage', {
            TEXTURE_BINDING: 4,
            COPY_DST: 2,
            RENDER_ATTACHMENT: 16,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // The stub device satisfies the cache's real surface (limits, createTexture,
    // createBindGroup, queue.copyExternalImageToTexture). Cast once here so each
    // test reads as plain data, not a casting exercise.
    const makeCache = (maxCachedLabels = 256) =>
        createClipLabelTextureCache({
            device: handles.device as unknown as GPUDevice,
            bindGroupLayout: handles.bindGroupLayout,
            sampler: handles.sampler,
            maxCachedLabels,
        });

    it('rejects an empty label and never touches the device', () => {
        const cache = makeCache();

        const result = cache.acquire({ text: '', maxWidthCssPx: 100, dpr: 1 });

        expect(result).toBeNull();
        expect(handles.device.createTexture).not.toHaveBeenCalled();
        expect(handles.device.createBindGroup).not.toHaveBeenCalled();
    });

    it('rejects a non-positive width budget and never touches the device', () => {
        const cache = makeCache();

        expect(cache.acquire({ text: 'Kick', maxWidthCssPx: 0, dpr: 1 })).toBeNull();
        expect(cache.acquire({ text: 'Kick', maxWidthCssPx: -5, dpr: 1 })).toBeNull();
        expect(handles.device.createTexture).not.toHaveBeenCalled();
    });

    it('returns a bind group and the condensed width on a cache miss', () => {
        const cache = makeCache();

        const result = cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });

        expect(result).not.toBeNull();
        // The measuring context reported a 30px advance; that is narrower than
        // the 100px budget and the 8192px device ceiling, so the cache uses the
        // run's own width as the condensed target. At dpr 1 that is 30 texels.
        expect(result?.widthDevicePx).toBe(30);
        // A plain run with no reported ink box needs no room outside the pen,
        // so the quad sits exactly at the layout's pen position.
        expect(result?.offsetXDevicePx).toBe(0);
        expect(result?.offsetYDevicePx).toBe(0);
        expect(result?.bindGroup).toEqual({ id: 'bg-1' });
        // The first call creates exactly one texture and one bind group.
        expect(handles.device.createTexture).toHaveBeenCalledTimes(1);
        expect(handles.device.createBindGroup).toHaveBeenCalledTimes(1);
    });

    it('clamps the width to the clip budget when the glyph run exceeds it', () => {
        const cache = makeCache();

        const result = cache.acquire({ text: 'Kick', maxWidthCssPx: 20, dpr: 1 });

        expect(result?.widthDevicePx).toBe(20);
        // The texture is sized in device pixels: ceil(budgetCss * dpr) wide,
        // ceil(blockHeight * dpr) tall.
        expect(handles.device.createTexture).toHaveBeenCalledWith(
            expect.objectContaining({
                size: {
                    width: 20,
                    height: CLIP_LABEL_BLOCK_HEIGHT_CSS_PX,
                },
                format: 'rgba8unorm',
            })
        );
    });

    it('hands the 2D context the condensed width so fillText condenses the run', () => {
        const { fillTextAll } = install_offscreen_canvas_stub(() => ({ width: 60 }));
        const cache = makeCache();

        // Glyph run 60, budget 40 — the cache must condense into 40.
        cache.acquire({ text: 'LongLabel', maxWidthCssPx: 40, dpr: 1 });

        expect(fillTextAll).toHaveBeenCalledTimes(1);
        // fillText(text, x, y, maxWidth)
        const fillArgs = fillTextAll.mock.calls[0];
        expect(fillArgs?.[0]).toBe('LongLabel');
        // maxWidth is the 4th arg and must be the condensed budget.
        expect(fillArgs?.[3]).toBe(40);
    });

    it('scales the raster by dpr and uses the block-height constant for the texture height', () => {
        const cache = makeCache();

        cache.acquire({ text: 'Kick', maxWidthCssPx: 30, dpr: 2 });

        expect(handles.device.createTexture).toHaveBeenCalledWith(
            expect.objectContaining({
                size: {
                    // ceil(30 * 2) = 60
                    width: 60,
                    // ceil(blockHeight * 2) = ceil(14 * 2) = 28
                    height: CLIP_LABEL_BLOCK_HEIGHT_CSS_PX * 2,
                },
            })
        );
    });

    it('reuses the cached entry on a second acquire and does not allocate again', () => {
        const cache = makeCache();

        const first = cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });
        const second = cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });

        // Same bind group reference returned both times.
        expect(second?.bindGroup).toBe(first?.bindGroup);
        // Only one texture + one bind group allocated across both calls.
        expect(handles.device.createTexture).toHaveBeenCalledTimes(1);
        expect(handles.device.createBindGroup).toHaveBeenCalledTimes(1);
    });

    it('treats a different quantised width or dpr as a distinct key', () => {
        const cache = makeCache();

        cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });
        cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 2 });
        cache.acquire({ text: 'Kick', maxWidthCssPx: 50, dpr: 1 });

        // Three distinct keys → three textures + three bind groups.
        expect(handles.device.createTexture).toHaveBeenCalledTimes(3);
        expect(handles.device.createBindGroup).toHaveBeenCalledTimes(3);
    });

    it('quantises sub-pixel width differences so zoom jitter does not thrash the cache', () => {
        const cache = makeCache();

        cache.acquire({ text: 'Kick', maxWidthCssPx: 100.3, dpr: 1 });
        cache.acquire({ text: 'Kick', maxWidthCssPx: 100.49, dpr: 1 });

        // Both round to 100 → same key → one allocation.
        expect(handles.device.createTexture).toHaveBeenCalledTimes(1);
    });

    it('evicts the least-recently-used entry past the retention bound once the frame closes', () => {
        const cache = makeCache();

        // Frame 1: 256 distinct labels, exactly the retention bound.
        for (let i = 0; i < 256; i += 1) {
            cache.acquire({ text: `label-${i}`, maxWidthCssPx: 100, dpr: 1 });
        }
        cache.endFrame();
        expect(handles.device.createTexture.mock.calls.length).toBe(256);
        expect(handles.destroyedTextures).toHaveLength(0);

        // Frame 2: one new label. label-0 was inserted first and is not pinned
        // by this frame, so it is the LRU victim.
        cache.acquire({ text: `label-256`, maxWidthCssPx: 100, dpr: 1 });
        cache.endFrame();

        expect(handles.device.createTexture.mock.calls.length).toBe(257);
        expect(handles.destroyedTextures).toEqual(['tex-1']);
    });

    it('holds an evicted texture until endFrame rather than destroying it mid-frame', () => {
        const cache = makeCache();

        // All 257 in one frame. The 257th pushes the cache past its bound, but
        // the caller has not submitted yet — the first label's bind group is
        // already queued for this frame, so destroying its texture now costs
        // the whole frame.
        for (let i = 0; i < 257; i += 1) {
            cache.acquire({ text: `label-${i}`, maxWidthCssPx: 100, dpr: 1 });
        }

        expect(handles.destroyedTextures).toHaveLength(0);

        cache.endFrame();

        expect(handles.destroyedTextures).toEqual(['tex-1']);
    });

    it('never evicts an entry the open frame has handed out, however far past the bound', () => {
        // A deliberately tiny bound: 300 labels in one frame is 75× it. If the
        // cache can be made to destroy an in-frame texture at all, this is
        // where it happens — and no constant in the production wiring can hide
        // it, because the bound is the fixture.
        const cache = makeCache(4);

        const acquired = [];
        for (let i = 0; i < 300; i += 1) {
            acquired.push(cache.acquire({ text: `label-${i}`, maxWidthCssPx: 100, dpr: 1 }));
        }

        expect(acquired.filter((entry) => entry !== null)).toHaveLength(300);
        // Every one of the 300 got its own bind group, and not one texture was
        // destroyed while the frame was open.
        expect(new Set(handles.bindGroups).size).toBe(300);
        expect(handles.destroyedTextures).toHaveLength(0);

        cache.endFrame();

        // Closing the frame gives the overshoot back: 4 retained, 296 released.
        expect(handles.destroyedTextures).toHaveLength(296);
    });

    it('promotes a re-acquired entry to most-recent so it survives a later eviction', () => {
        const cache = makeCache();

        for (let i = 0; i < 256; i += 1) {
            cache.acquire({ text: `label-${i}`, maxWidthCssPx: 100, dpr: 1 });
        }
        cache.endFrame();

        // Touch label-0 — it moves to the back (most-recent).
        cache.acquire({ text: `label-0`, maxWidthCssPx: 100, dpr: 1 });
        // Now the oldest is label-1. Inserting a new label evicts label-1, not label-0.
        cache.acquire({ text: `label-256`, maxWidthCssPx: 100, dpr: 1 });
        cache.endFrame();

        // tex-2 was the texture allocated for label-1 (the second insertion).
        expect(handles.destroyedTextures).toEqual(['tex-2']);
    });

    it('keys the cache so a different width and a text that starts with a digit cannot collide', () => {
        const cache = makeCache();

        // Concatenating dpr, width and text without a separator makes these two
        // the same key: "1" + "23" + "foo" and "1" + "2" + "3foo". The second
        // clip would then be served the first clip's raster.
        cache.acquire({ text: 'foo', maxWidthCssPx: 23, dpr: 1 });
        cache.acquire({ text: '3foo', maxWidthCssPx: 2, dpr: 1 });

        expect(handles.device.createTexture).toHaveBeenCalledTimes(2);
        expect(new Set(handles.bindGroups).size).toBe(2);
    });

    /**
     * The pen advance is where the cursor lands, not where the paint lands. An
     * italic's last glyph leans past it, an emoji is drawn wider than it
     * advances, and Devanagari, Thai and Arabic all carry marks outside it — on
     * the left as well as the right, and above the Latin ascent. A raster cut
     * to the advance and the nominal ascent/descent block shears all of that
     * off, and the missing pixels are silent.
     */
    describe('ink box', () => {
        // A run that overhangs the pen in all four directions: 2px of left side
        // bearing, 6px of lean past the 30px advance, 3px above the nominal
        // 10px ascent, 2px below the nominal 4px descent.
        const overhanging_run = () => ({
            width: 30,
            actualBoundingBoxLeft: 2,
            actualBoundingBoxRight: 36,
            actualBoundingBoxAscent: 13,
            actualBoundingBoxDescent: 6,
        });

        it('contains the whole ink box in the raster, not just the advance box', () => {
            const { fillTextAll } = install_offscreen_canvas_stub(overhanging_run);
            const cache = makeCache();

            const result = cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });

            // Where the cache put the pen inside its own raster.
            const [, penX, penBaselineY] = fillTextAll.mock.calls[0] as [string, number, number, number];
            const ink = overhanging_run();

            // Ink left of the pen must land at or after the raster's left edge,
            // and ink right of it at or before the right edge. Same vertically
            // about the baseline. These four inequalities are the whole point:
            // an advance-sized raster fails the first and the last two.
            expect(penX - ink.actualBoundingBoxLeft).toBeGreaterThanOrEqual(0);
            expect(penBaselineY - ink.actualBoundingBoxAscent).toBeGreaterThanOrEqual(0);
            expect(result?.widthDevicePx).toBeGreaterThanOrEqual(penX + ink.actualBoundingBoxRight);
            expect(result?.heightDevicePx).toBeGreaterThanOrEqual(penBaselineY + ink.actualBoundingBoxDescent);

            // And no larger than it needs to be — a raster that merely got big
            // enough by accident would satisfy the inequalities above.
            expect(result?.widthDevicePx).toBe(38);
            expect(result?.heightDevicePx).toBe(19);
        });

        it('offsets the quad by the overhang so the glyphs land where the layout asked', () => {
            install_offscreen_canvas_stub(overhanging_run);
            const cache = makeCache();

            const result = cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });

            // The raster grew 2px left and 3px up to hold the overhang, so the
            // caller has to place it 2px left and 3px up of the pen position —
            // otherwise widening the raster silently shifts the text right.
            expect(result?.offsetXDevicePx).toBe(-2);
            expect(result?.offsetYDevicePx).toBe(-3);
        });

        it('shrinks the ink box by the same factor fillText condenses the run', () => {
            // 60px advance squeezed into a 30px budget: `maxWidth` condenses
            // horizontally by half, so 72px of ink becomes 36px and 4px of side
            // bearing becomes 2px. Sizing from the unsqueezed ink would ask for
            // a raster twice as wide as the paint.
            install_offscreen_canvas_stub(() => ({
                width: 60,
                actualBoundingBoxLeft: 4,
                actualBoundingBoxRight: 72,
                actualBoundingBoxAscent: 10,
                actualBoundingBoxDescent: 4,
            }));
            const cache = makeCache();

            const result = cache.acquire({ text: 'LongLabel', maxWidthCssPx: 30, dpr: 1 });

            // 2px bearing + 36px condensed ink.
            expect(result?.widthDevicePx).toBe(38);
            expect(result?.offsetXDevicePx).toBe(-2);
        });

        it('keeps the nominal block when the engine reports no ink box', () => {
            // Older engines omit the actualBoundingBox* fields. The cache must
            // fall back to the advance and the shared ascent/descent constants
            // rather than producing a 1px or NaN-sized raster.
            install_offscreen_canvas_stub(() => ({ width: 30 }));
            const cache = makeCache();

            const result = cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 2 });

            expect(result?.widthDevicePx).toBe(60);
            expect(result?.heightDevicePx).toBe(CLIP_LABEL_BLOCK_HEIGHT_CSS_PX * 2);
            expect(result?.offsetXDevicePx).toBe(0);
            expect(result?.offsetYDevicePx).toBe(0);
        });
    });

    it('destroys every held texture on dispose and empties the cache', () => {
        const cache = makeCache();

        cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });
        cache.acquire({ text: 'Snare', maxWidthCssPx: 100, dpr: 1 });
        expect(handles.destroyedTextures).toHaveLength(0);

        cache.dispose();

        expect(handles.destroyedTextures).toHaveLength(2);
    });

    it('serves a cached label after dispose is followed by a fresh acquire', () => {
        const cache = makeCache();

        cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });
        cache.dispose();

        // Cache is empty after dispose; a new acquire must allocate again.
        const after = cache.acquire({ text: 'Kick', maxWidthCssPx: 100, dpr: 1 });
        expect(after?.bindGroup).toBeDefined();
        expect(handles.device.createTexture.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
