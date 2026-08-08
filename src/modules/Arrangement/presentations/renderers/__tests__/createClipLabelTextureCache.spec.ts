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

function install_offscreen_canvas_stub(measuredWidth: () => number): {
    contexts: LabelContext[];
    fillTextAll: ReturnType<typeof vi.fn>;
} {
    const contexts: LabelContext[] = [];
    const fillTextAll = vi.fn();
    class OffscreenCanvasStub {
        width: number;
        height: number;

        constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
        }

        getContext(contextId: string): LabelContext | null {
            if (contextId !== '2d') {
                return null;
            }
            const ctx: LabelContext = {
                measureText: vi.fn(() => ({ width: measuredWidth() })),
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
    return { contexts, fillTextAll };
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
        install_offscreen_canvas_stub(() => 30);
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
    const makeCache = () =>
        createClipLabelTextureCache({
            device: handles.device as unknown as GPUDevice,
            bindGroupLayout: handles.bindGroupLayout,
            sampler: handles.sampler,
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
        // The measuring context reported 30px; that is narrower than the 100px
        // budget and the 8192px device ceiling, so the cache uses the run's own
        // width as the condensed target.
        expect(result?.widthCssPx).toBe(30);
        expect(result?.bindGroup).toEqual({ id: 'bg-1' });
        // The first call creates exactly one texture and one bind group.
        expect(handles.device.createTexture).toHaveBeenCalledTimes(1);
        expect(handles.device.createBindGroup).toHaveBeenCalledTimes(1);
    });

    it('clamps the width to the clip budget when the glyph run exceeds it', () => {
        const cache = makeCache();

        const result = cache.acquire({ text: 'Kick', maxWidthCssPx: 20, dpr: 1 });

        expect(result?.widthCssPx).toBe(20);
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
        const { fillTextAll } = install_offscreen_canvas_stub(() => 60);
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

    it('evicts the least-recently-used entry past MAX_CACHED_LABELS and destroys its texture', () => {
        const cache = makeCache();

        // Insert 256 distinct labels. The 257th must evict label-1 (the oldest).
        for (let i = 0; i < 256; i += 1) {
            cache.acquire({ text: `label-${i}`, maxWidthCssPx: 100, dpr: 1 });
        }
        const textureCountBefore = handles.device.createTexture.mock.calls.length;
        expect(textureCountBefore).toBe(256);
        expect(handles.destroyedTextures).toHaveLength(0);

        // Insert one more — label-0 was inserted first and never re-acquired,
        // so it is the LRU victim.
        cache.acquire({ text: `label-256`, maxWidthCssPx: 100, dpr: 1 });

        expect(handles.device.createTexture.mock.calls.length).toBe(257);
        expect(handles.destroyedTextures).toHaveLength(1);
        // tex-1 is the texture allocated for the first label-0 acquire.
        expect(handles.destroyedTextures[0]).toBe('tex-1');
    });

    it('promotes a re-acquired entry to most-recent so it survives a later eviction', () => {
        const cache = makeCache();

        for (let i = 0; i < 256; i += 1) {
            cache.acquire({ text: `label-${i}`, maxWidthCssPx: 100, dpr: 1 });
        }
        // Touch label-0 — it moves to the back (most-recent).
        cache.acquire({ text: `label-0`, maxWidthCssPx: 100, dpr: 1 });

        // Now the oldest is label-1. Inserting a new label evicts label-1, not label-0.
        cache.acquire({ text: `label-256`, maxWidthCssPx: 100, dpr: 1 });

        expect(handles.destroyedTextures).toHaveLength(1);
        // tex-2 was the texture allocated for label-1 (the second insertion).
        expect(handles.destroyedTextures[0]).toBe('tex-2');
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
