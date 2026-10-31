import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    forEachMidiNoteRect,
    resolveMidiClipFrame,
    resolveMidiPitchWindow,
    type InlineMidiGeometryClip,
} from '../../../models/InlineMidiGeometry';
import { type TimelineRenderModel } from '../../../models/TimelineRenderModel';
import { drawClip } from '../clipDrawing';
import { CLIP_LABEL_ASCENT_CSS_PX, CLIP_LABEL_INSET_CSS_PX } from '../clipLabel';

type GetCachedAudioBufferMock = (input: { bufferId: string }) => AudioBuffer | null;

type GetCachedAudioBufferWaveformPeaksMock = (input: {
    bufferId: string;
    numBins: number;
    startSample?: number;
    endSample?: number;
}) => Float32Array;

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<GetCachedAudioBufferMock>(),
    getCachedAudioBufferWaveformPeaks: vi.fn<GetCachedAudioBufferWaveformPeaksMock>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    getCachedAudioBufferWaveformPeaks: mocks.getCachedAudioBufferWaveformPeaks,
}));

const original_device_pixel_ratio = window.devicePixelRatio;

const create_test_audio_buffer = (sampleRate = 48_000, length = 96_000): AudioBuffer => {
    const channel_data = new Float32Array(length);
    return {
        copyFromChannel: (destination, _channel_number, start_in_channel = 0) => {
            destination.set(channel_data.subarray(start_in_channel, start_in_channel + destination.length));
        },
        copyToChannel: (source, _channel_number, start_in_channel = 0) => {
            channel_data.set(source, start_in_channel);
        },
        duration: channel_data.length / sampleRate,
        getChannelData: () => channel_data,
        length: channel_data.length,
        numberOfChannels: 1,
        sampleRate,
    };
};

const create_test_model = (): TimelineRenderModel => ({
    dataDirty: false,
    tracks: [
        {
            id: 'track-1',
            name: 'Audio',
            index: 0,
            kind: 'audio',
            color: '#224466',
            muted: false,
            soloed: false,
            height: 48,
            automationMode: 'read',
            clips: [
                {
                    id: 'clip-1',
                    startBeat: 2,
                    endBeat: 6,
                    name: 'Audio Clip',
                    color: '#336699',
                    type: 'audio',
                    muted: false,
                    midiNotes: [],
                    audioBufferId: 'buf-1',
                    audioOffsetBeats: 1,
                    stretchRatio: 2,
                    stretchMode: 'timestretch',
                    loopEnabled: false,
                    loopLength: undefined,
                    midiOffsetBeats: 0,
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                },
            ],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    playheadPosition: 0,
    viewportStartBeat: 0,
    viewportEndBeat: 16,
    beatsPerPixel: 1 / 25,
    pixelsPerBeat: 25,
    trackHeight: 48,
    scrollY: 0,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
});

type WebGpuMockHandles = {
    draw: ReturnType<typeof vi.fn>;
    writeBuffer: ReturnType<typeof vi.fn>;
    /** Every `fillText` call made on a rasterised label's OffscreenCanvas 2D context. */
    labelFillText: ReturnType<typeof vi.fn>;
    /** Every `createTexture` descriptor the renderer asked the device for. */
    createTexture: ReturnType<typeof vi.fn>;
    setBindGroup: ReturnType<typeof vi.fn>;
    /**
     * Ids of the label textures whose bind group the *current* frame encoded,
     * in encode order. Reset by `startFrameRecording`.
     */
    boundTextureIds: string[];
    /**
     * Ids of every label texture destroyed, in destruction order. A texture
     * that appears here before the frame that bound it reached `submit` is the
     * frame-loss bug: WebGPU rejects the whole command buffer.
     */
    destroyedTextureIds: string[];
    /** Snapshot of `destroyedTextureIds` taken the instant `queue.submit` ran. */
    destroyedAtSubmit: string[];
    /** Text-quad vertex floats captured at `writeBuffer` time, per frame. */
    textQuadWrites: Float32Array[];
    /** Clear the per-frame recorders so one `render` call can be read in isolation. */
    startFrameRecording: () => void;
};

/**
 * jsdom has no `OffscreenCanvas`. The label rasteriser is the conventional
 * WebGPU text path (2D `fillText` → texture upload), so stubbing it lets the
 * spec observe exactly which strings the renderer rasterises for which clips.
 */
function install_offscreen_canvas_stub(
    labelFillText: ReturnType<typeof vi.fn>,
    measuredWidthCssPx = 10,
    inkMetrics: {
        actualBoundingBoxLeft?: number;
        actualBoundingBoxRight?: number;
        actualBoundingBoxAscent?: number;
        actualBoundingBoxDescent?: number;
    } = {}
): void {
    class OffscreenCanvasStub {
        width: number;
        height: number;

        constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
        }

        getContext(contextId: string): unknown {
            if (contextId !== '2d') {
                return null;
            }
            return {
                canvas: this,
                font: '',
                fillStyle: '',
                textBaseline: '',
                scale: vi.fn(),
                clearRect: vi.fn(),
                fillText: labelFillText,
                measureText: vi.fn(() => ({ width: measuredWidthCssPx, ...inkMetrics })),
            };
        }
    }
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasStub);
}

function install_webgpu_mocks(canvas: HTMLCanvasElement): WebGpuMockHandles {
    const draw = vi.fn();
    const labelFillText = vi.fn();

    // Label textures carry an identity so the spec can follow one texture from
    // `createTexture` through the bind group that samples it, into the render
    // pass that encodes it, and out through `destroy`. Without the identity a
    // destroyed-while-queued texture is invisible: every stub texture looks the
    // same.
    const destroyedTextureIds: string[] = [];
    const destroyedAtSubmit: string[] = [];
    let textureSeq = 0;
    const createTexture = vi.fn(() => {
        const id = `label-tex-${(textureSeq += 1)}`;
        return {
            id,
            createView: vi.fn(() => ({ textureId: id })),
            destroy: vi.fn(() => {
                destroyedTextureIds.push(id);
            }),
        };
    });
    // Binding 1 of the text pipeline's group 0 is the label's texture view, so
    // the descriptor is what ties a bind group back to its texture.
    const createBindGroup = vi.fn((descriptor?: { entries?: { resource?: { textureId?: string } }[] }) => ({
        textureId: descriptor?.entries?.[1]?.resource?.textureId,
    }));

    const boundTextureIds: string[] = [];
    const setBindGroup = vi.fn((_index: number, group?: { textureId?: string }) => {
        if (group?.textureId !== undefined) {
            boundTextureIds.push(group.textureId);
        }
    });

    // The renderer creates the rect vertex buffer first and the text quad
    // buffer second, and reuses both across frames — so the CPU-side array is
    // mutated in place and has to be copied at write time, not read afterwards.
    let bufferSeq = 0;
    let textBufferIndex = -1;
    const textQuadWrites: Float32Array[] = [];
    const writeBuffer = vi.fn(
        (
            buffer?: { bufferIndex?: number },
            _offset?: number,
            data?: Float32Array,
            dataOffset?: number,
            size?: number
        ) => {
            if (buffer?.bufferIndex !== textBufferIndex || !data) {
                return;
            }
            textQuadWrites.push(data.slice(dataOffset ?? 0, (dataOffset ?? 0) + (size ?? data.length)));
        }
    );

    const submit = vi.fn(() => {
        destroyedAtSubmit.length = 0;
        destroyedAtSubmit.push(...destroyedTextureIds);
    });

    const render_pass = {
        setPipeline: vi.fn(),
        setVertexBuffer: vi.fn(),
        setBindGroup,
        draw,
        end: vi.fn(),
    };
    const gpu_context = {
        configure: vi.fn(),
        getCurrentTexture: vi.fn(() => ({
            createView: vi.fn(() => ({})),
        })),
    };
    const device = {
        createShaderModule: vi.fn(() => ({})),
        createRenderPipeline: vi.fn(() => ({
            getBindGroupLayout: vi.fn(() => ({})),
        })),
        createBuffer: vi.fn(({ size }: { size: number }) => {
            const bufferIndex = bufferSeq++;
            // Buffer 0 is the rect vertex buffer, buffer 1 the text quad buffer.
            if (bufferIndex === 1) {
                textBufferIndex = bufferIndex;
            }
            return { size, bufferIndex, destroy: vi.fn() };
        }),
        createSampler: vi.fn(() => ({})),
        // Every real `GPUDevice` exposes `limits`, and the label cache reads
        // `maxTextureDimension2D` from it to bound the raster it asks for. 8192
        // is the WebGPU default a device must support.
        limits: { maxTextureDimension2D: 8192 },
        createTexture,
        createBindGroup,
        queue: {
            writeBuffer,
            submit,
            copyExternalImageToTexture: vi.fn(),
        },
        createCommandEncoder: vi.fn(() => ({
            beginRenderPass: vi.fn(() => render_pass),
            finish: vi.fn(() => ({})),
        })),
        destroy: vi.fn(),
    };
    const adapter = {
        requestDevice: vi.fn().mockResolvedValue(device),
    };
    const gpu = {
        requestAdapter: vi.fn().mockResolvedValue(adapter),
        getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    };

    Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: vi.fn((context_id: string) => {
            if (context_id === 'webgpu') {
                return gpu_context;
            }
            return null;
        }),
    });
    Object.defineProperty(navigator, 'gpu', {
        configurable: true,
        value: gpu,
    });
    vi.stubGlobal('GPUBufferUsage', {
        COPY_DST: 2,
        VERTEX: 1,
    });
    vi.stubGlobal('GPUTextureUsage', {
        TEXTURE_BINDING: 4,
        COPY_DST: 2,
        RENDER_ATTACHMENT: 16,
    });
    install_offscreen_canvas_stub(labelFillText);

    return {
        draw,
        writeBuffer,
        labelFillText,
        createTexture,
        setBindGroup,
        boundTextureIds,
        destroyedTextureIds,
        destroyedAtSubmit,
        textQuadWrites,
        startFrameRecording: () => {
            boundTextureIds.length = 0;
            destroyedAtSubmit.length = 0;
            textQuadWrites.length = 0;
        },
    };
}

/**
 * Recover the device-px left edge of every waveform rect the last frame
 * encoded, from the rect vertex buffer the mock captured at `writeBuffer`
 * time. Waveform bins are the only rects an unmuted clip draws at alpha
 * 0.18 (`alpha * 0.18`; body, background and accent sit at 1, the row
 * separator at 0.6, the grid at 0.04/0.08, the playhead at 0.9), so alpha
 * identifies them in the vertex stream without knowing the rect order.
 */
function decode_waveform_rect_left_edges(handles: WebGpuMockHandles, canvas: HTMLCanvasElement): number[] {
    const rect_write = handles.writeBuffer.mock.calls.find(
        (call: unknown[]) => (call[0] as { bufferIndex?: number } | undefined)?.bufferIndex === 0
    );
    if (!rect_write) {
        throw new Error('expected the frame to write the rect vertex buffer');
    }
    const data = rect_write[2] as Float32Array;
    // 6 vertices × 6 floats (xy + rgba) per rect, matching pushRect.
    const floatsPerRect = 36;
    const rectCount = (rect_write[4] as number) / floatsPerRect;
    const leftEdges: number[] = [];
    for (let rect = 0; rect < rectCount; rect++) {
        const base = rect * floatsPerRect;
        if (Math.abs(data[base + 5]! - 0.18) > 1e-6) {
            continue;
        }
        leftEdges.push(((data[base]! + 1) / 2) * canvas.width);
    }
    return leftEdges;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedAudioBuffer.mockReturnValue(null);
    mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array());
    Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: 1,
    });
});

afterEach(() => {
    Reflect.deleteProperty(navigator, 'gpu');
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: original_device_pixel_ratio,
    });
});

/** One rect the frame wrote to the vertex buffer, in device pixels, with its alpha. */
type DecodedRect = { x1: number; y1: number; x2: number; y2: number; alpha: number };

function decode_rects(handles: WebGpuMockHandles, canvas: HTMLCanvasElement): DecodedRect[] {
    const rect_write = handles.writeBuffer.mock.calls.find(
        (call: unknown[]) => (call[0] as { bufferIndex?: number } | undefined)?.bufferIndex === 0
    );
    if (!rect_write) {
        throw new Error('expected the frame to write the rect vertex buffer');
    }
    const data = rect_write[2] as Float32Array;
    // 6 vertices x 6 floats (xy + rgba) per rect, matching pushRect: vertex 0 is
    // the top-left corner, vertex 1 the top-right, vertex 2 the bottom-left.
    const floatsPerRect = 36;
    const rect_count = (rect_write[4] as number) / floatsPerRect;
    const rects: DecodedRect[] = [];
    for (let rect = 0; rect < rect_count; rect++) {
        const base = rect * floatsPerRect;
        rects.push({
            x1: ((data[base]! + 1) / 2) * canvas.width,
            y1: ((1 - data[base + 1]!) / 2) * canvas.height,
            x2: ((data[base + 6]! + 1) / 2) * canvas.width,
            y2: ((1 - data[base + 13]!) / 2) * canvas.height,
            alpha: data[base + 5]!,
        });
    }
    return rects;
}

describe('createWebGpuRenderer clip name labels', () => {
    it('rasterises each visible clip name at the shared Canvas2D label geometry', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        renderer.render(create_test_model());

        // The clip spans beats 2..6 at 25 px/beat → 100 CSS px wide, so the
        // squeeze budget is `100 - 2 * inset` = 88. Inside its own texture the
        // glyph run starts at the origin and sits on the shared ascent; the
        // timeline placement is carried by the quad, not by `fillText`.
        //
        // The `maxWidth` argument is the *raster* width, which is the narrower
        // of the run and that budget — here the stubbed run, 10 px. `maxWidth`
        // only ever condenses, so passing the run's own width when it already
        // fits is a no-op, and passing the budget when it does not is the
        // condense. Sizing the raster from the budget instead would ask for a
        // texture as wide as the clip is drawn, which past
        // `maxTextureDimension2D` is a validation error and a missing label.
        expect(handles.labelFillText).toHaveBeenCalledWith('Audio Clip', 0, CLIP_LABEL_ASCENT_CSS_PX, 10);
        expect(10).toBeLessThan(100 - CLIP_LABEL_INSET_CSS_PX * 2);
        expect(handles.setBindGroup).toHaveBeenCalled();
    });

    it('skips the label when the clip is too narrow to hold any text', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        const base = create_test_model();
        // 0.4 beats × 25 px/beat = 10 CSS px < the 12 px of horizontal inset,
        // so `maxWidth` is non-positive and Canvas2D's `fillText` draws nothing.
        const narrow: TimelineRenderModel = {
            ...base,
            tracks: [{ ...base.tracks[0]!, clips: [{ ...base.tracks[0]!.clips[0]!, endBeat: 2.4 }] }],
        };

        renderer.render(narrow);

        expect(handles.labelFillText).not.toHaveBeenCalled();
    });

    it('reuses one cached texture for an unchanged label and re-rasterises when zoom changes', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        const model = create_test_model();
        renderer.render(model);
        renderer.render(model);
        const afterTwoIdenticalFrames = handles.createTexture.mock.calls.length;

        renderer.render({ ...model, pixelsPerBeat: 50 });

        expect(afterTwoIdenticalFrames).toBe(1);
        expect(handles.createTexture.mock.calls.length).toBe(2);
    });

    it('sizes a label raster to the glyph run, not to the clip it sits on', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        // A long clip at editing zoom. 400 beats × 25 px/beat is 10 000 CSS px
        // of drawn clip — well past `maxTextureDimension2D` once dpr is applied,
        // and the whole point is that the label does not care how wide the clip
        // is. The stubbed `measureText` reports a 10 px glyph run.
        const base = create_test_model();
        const wide: TimelineRenderModel = {
            ...base,
            tracks: [{ ...base.tracks[0]!, clips: [{ ...base.tracks[0]!.clips[0]!, startBeat: 0, endBeat: 400 }] }],
        };

        renderer.render(wide);

        const lastCall = handles.createTexture.mock.calls.at(-1) as [GPUTextureDescriptor] | undefined;
        const width = lastCall?.[0].size as { width: number } | undefined;
        expect(width?.width).toBeLessThanOrEqual(8192);
        // The run is 10 CSS px, so the raster is that wide (times dpr), not the
        // clip's 10 000. Asserting the actual value rather than just the ceiling
        // keeps this from passing on a texture that is merely clamped.
        expect(width?.width).toBe(10);
    });
});

/**
 * One clip per beat, each with its own name, so the number of *distinct* label
 * cache keys in a single frame is exactly `clipCount`. Every clip is 25 CSS px
 * wide, which clears the 12 px inset pair and so renders a label.
 */
const create_many_labelled_clips_model = (clipCount: number, namePrefix = 'Clip'): TimelineRenderModel => {
    const base = create_test_model();
    const template = base.tracks[0]!.clips[0]!;
    const clips = Array.from({ length: clipCount }, (_unused, index) => ({
        ...template,
        id: `clip-${index}`,
        name: `${namePrefix} ${index}`,
        startBeat: index,
        endBeat: index + 1,
        audioBufferId: undefined,
        type: 'midi' as const,
        midiNotes: [],
    }));
    return {
        ...base,
        tracks: [{ ...base.tracks[0]!, clips }],
        viewportEndBeat: clipCount,
    };
};

const create_wide_renderer_canvas = (clipCount: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    // 25 device px per beat at dpr 1, plus slack, so no clip is viewport-culled.
    canvas.width = clipCount * 25 + 100;
    canvas.height = 80;
    return canvas;
};

/**
 * The label cache evicts by destroying a `GPUTexture`. The renderer collects
 * every label's bind group during the clip pass and only encodes them into the
 * render pass *after* that pass finishes — so any texture destroyed during the
 * pass is destroyed while a bind group referencing it is already queued for the
 * frame. WebGPU rejects the whole command buffer at submit: not one missing
 * label, the entire frame.
 *
 * These guards live past the cache's retention bound on purpose. A frame with
 * ten labels never evicts and passes identically with the bug present.
 */
describe('createWebGpuRenderer label texture lifetime across one frame', () => {
    const render_one_frame = async (clipCount: number) => {
        const canvas = create_wide_renderer_canvas(clipCount);
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        handles.startFrameRecording();
        renderer.render(create_many_labelled_clips_model(clipCount));
        return handles;
    };

    it('keeps every encoded label texture alive through submit at 257 distinct labels', async () => {
        const handles = await render_one_frame(257);

        // The fixture really does put 257 distinct labels in the frame — the
        // assertion below is worthless if the frame quietly drew fewer.
        expect(handles.boundTextureIds).toHaveLength(257);

        const destroyedWhileQueued = handles.boundTextureIds.filter((id) => handles.destroyedAtSubmit.includes(id));
        expect(destroyedWhileQueued).toEqual([]);
    });

    it('keeps every encoded label texture alive through submit at 256 distinct labels', async () => {
        const handles = await render_one_frame(256);

        expect(handles.boundTextureIds).toHaveLength(256);
        expect(handles.destroyedAtSubmit).toEqual([]);
    });

    it('keeps every encoded label texture alive through submit well past the retention bound', async () => {
        const handles = await render_one_frame(500);

        expect(handles.boundTextureIds).toHaveLength(500);

        const destroyedWhileQueued = handles.boundTextureIds.filter((id) => handles.destroyedAtSubmit.includes(id));
        expect(destroyedWhileQueued).toEqual([]);
    });

    it('rasterises a 400-label frame once, not once per frame', async () => {
        const canvas = create_wide_renderer_canvas(400);
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        const model = create_many_labelled_clips_model(400);

        renderer.render(model);
        const afterFirstFrame = handles.createTexture.mock.calls.length;
        renderer.render(model);
        renderer.render(model);

        // 400 distinct labels, three identical frames. A cache that retains the
        // frame's working set rasterises 400 textures and no more; one that
        // evicts inside the frame re-rasterises all 400 every frame.
        expect(afterFirstFrame).toBe(400);
        expect(handles.createTexture.mock.calls.length).toBe(400);
    });

    it('reclaims label textures once later frames stop naming them', async () => {
        const canvas = create_wide_renderer_canvas(400);
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        // Two frames, 400 distinct names each, none shared — renaming a folder
        // of takes, or scrolling a long arrangement. 800 rasters against a 512
        // retention bound, so 288 of the first frame's must be given back.
        renderer.render(create_many_labelled_clips_model(400, 'First'));
        renderer.render(create_many_labelled_clips_model(400, 'Second'));

        // Deferring destruction is not the same as never destroying. A renderer
        // that stops closing its frames leaks every texture it ever rasterised.
        expect(handles.destroyedTextureIds).toHaveLength(288);
    });
});

/**
 * The label sampler filters linearly. A quad whose edges land between texel
 * centres therefore resolves as a blur rather than as the glyphs, and because
 * the fractional part moves with the scroll offset, the blur crawls while the
 * timeline moves. Two things have to hold: the quad's origin is a whole device
 * pixel, and its extent is exactly the raster's — a quad a fraction narrower
 * than its texture minifies it, which blurs even at an integral origin.
 *
 * A power-of-two canvas keeps the clip-space round trip exact in float32, so
 * these read the vertices the GPU would actually receive.
 */
describe('createWebGpuRenderer label quad device-pixel snapping', () => {
    const CANVAS_W = 2048;
    const CANVAS_H = 512;

    /** Undo `pushTexturedQuad`'s clip-space mapping to recover device px. */
    const read_quad_device_px = (quad: Float32Array) => ({
        x1: (quad[0]! + 1) * (CANVAS_W / 2),
        y1: (1 - quad[1]!) * (CANVAS_H / 2),
        x2: (quad[4]! + 1) * (CANVAS_W / 2),
        y2: (1 - quad[9]!) * (CANVAS_H / 2),
    });

    /**
     * One clip whose left edge and track offset are both fractional in CSS px —
     * which is the ordinary case, not a contrived one: any non-integer zoom or
     * mid-scroll position produces it.
     */
    const create_fractional_model = (): TimelineRenderModel => {
        const base = create_test_model();
        return {
            ...base,
            pixelsPerBeat: 25.3,
            scrollY: 0.5,
            tracks: [
                {
                    ...base.tracks[0]!,
                    clips: [
                        {
                            ...base.tracks[0]!.clips[0]!,
                            startBeat: 1,
                            endBeat: 2,
                            audioBufferId: undefined,
                            type: 'midi' as const,
                            midiNotes: [],
                        },
                    ],
                },
            ],
        };
    };

    const render_fractional_frame = async (
        dpr: number,
        measuredWidthCssPx: number,
        inkMetrics: {
            actualBoundingBoxLeft?: number;
            actualBoundingBoxRight?: number;
            actualBoundingBoxAscent?: number;
            actualBoundingBoxDescent?: number;
        } = {}
    ) => {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const handles = install_webgpu_mocks(canvas);
        install_offscreen_canvas_stub(vi.fn(), measuredWidthCssPx, inkMetrics);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        handles.startFrameRecording();
        renderer.render(create_fractional_model());
        const quad = handles.textQuadWrites.at(-1);
        if (!quad) {
            throw new Error('expected the frame to write a label quad');
        }
        return read_quad_device_px(quad);
    };

    it('places a label quad on whole device pixels from a fractional layout at dpr 1', async () => {
        // Pen at (1 × 25.3 + 6) = 31.3 CSS px, block top at (−0.5 + 4) = 3.5.
        const { x1, y1, x2, y2 } = await render_fractional_frame(1, 10);

        expect(Number.isInteger(x1)).toBe(true);
        expect(Number.isInteger(y1)).toBe(true);
        expect(x1).toBe(31);
        expect(y1).toBe(4);
        // A 10 CSS px run at dpr 1 is a 10-texel raster, and the quad covers it
        // exactly: one texel per device pixel.
        expect(x2 - x1).toBe(10);
        expect(y2 - y1).toBe(14);
    });

    it('matches the quad to the rounded-up raster size at dpr 2', async () => {
        // A 10.3 CSS px run at dpr 2 needs ceil(20.6) = 21 texels. Sizing the
        // quad from the CSS width instead gives 20.6 device px, so the raster
        // is minified by 2% — blurry at every position, integral or not.
        const { x1, y1, x2, y2 } = await render_fractional_frame(2, 10.3);

        expect(x1).toBe(63);
        expect(y1).toBe(7);
        expect(x2 - x1).toBe(21);
        expect(y2 - y1).toBe(28);
    });

    it('shifts the quad left by the raster overhang so the glyphs stay where the layout put them', async () => {
        // 2 CSS px of left side bearing: the raster grew leftwards to hold it,
        // so the quad has to move left by the same amount. Placing it at the
        // pen instead pushes every glyph 2px right of where the Canvas2D
        // renderer draws the same name.
        const { x1, x2 } = await render_fractional_frame(1, 10, {
            actualBoundingBoxLeft: 2,
            actualBoundingBoxRight: 12,
            actualBoundingBoxAscent: 10,
            actualBoundingBoxDescent: 4,
        });

        // Pen is at 31.3 device px; the raster starts 2px left of it.
        expect(x1).toBe(29);
        // 2px of bearing + 12px of ink.
        expect(x2 - x1).toBe(14);
    });
});

describe('createWebGpuRenderer audio waveform cache reads', () => {
    it('should draw cached audio waveform peaks through AudioEngine owner use cases', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer(48_000, 480_000));
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.1, 0.5, 0.25]));

        renderer.render(create_test_model());

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 100,
            startSample: 24_000,
            endSample: 216_000,
        });
        expect(handles.writeBuffer).toHaveBeenCalled();
        expect(handles.draw).toHaveBeenCalled();
    });

    it('requests the clip-start-tempo source window when the map tempo differs from base tempo', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 80;
        install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer(48_000, 480_000));
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.1, 0.5, 0.25]));
        const model = create_test_model();
        model.tracks[0]!.clips[0]!.clipStartTempo = 90;
        model.sourceTimeline = { secondsAtBeat: (beat) => (beat * 2) / 3, beatAtSeconds: (seconds) => seconds * 1.5 };
        renderer.render(model);
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith(
            expect.objectContaining({ startSample: 32_000, endSample: 288_000 })
        );
    });

    it('requests canonical PCM and places its bins through the captured tempo map', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer(48_000, 480_000));
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.1, 0.5, 0.25]));
        const model = create_test_model();
        Object.assign(model.tracks[0]!.clips[0]!, {
            startBeat: 4,
            endBeat: 8,
            audioOffsetBeats: 12,
            audioOffsetSeconds: 0,
            clipStartTempo: 60,
        });
        model.sourceTimeline = {
            secondsAtBeat: (beat) => {
                if (beat <= 4) {
                    return beat / 2;
                }
                if (beat <= 6) {
                    return 2 + beat - 4;
                }
                return 4 + (beat - 6) / 2;
            },
            beatAtSeconds: (seconds) => {
                if (seconds <= 2) {
                    return seconds * 2;
                }
                if (seconds <= 4) {
                    return 4 + seconds - 2;
                }
                return 6 + (seconds - 4) * 2;
            },
        };

        renderer.render(model);

        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 100,
            startSample: 0,
            endSample: 288000,
        });
        expect(decode_waveform_rect_left_edges(handles, canvas)).toEqual([100, 125, 150]);
    });

    it('draws the pre-roll as leading silence and shortens the material for a negative offset (#2519)', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.6, 0.6, 0.6, 0.6]));

        // The issue's worked example: 4-beat clip (2 s at 120 BPM) at offset
        // -1 beat. The scheduler plays 0.5 s of silence then the file's first
        // 1.5 s, so the renderer must reserve 1 beat (25 device px at dpr 1)
        // as leading silence and window the source at samples 0..72_000.
        const base = create_test_model();
        const model: TimelineRenderModel = {
            ...base,
            tracks: [
                {
                    ...base.tracks[0]!,
                    clips: [{ ...base.tracks[0]!.clips[0]!, audioOffsetBeats: -1, stretchRatio: 1 }],
                },
            ],
        };

        renderer.render(model);

        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 75, // 100 device px minus the 25 px pre-roll
            startSample: 0,
            endSample: 72_000,
        });

        // The first waveform bin's left edge sits at cx1 (50) + 25 px of
        // pre-roll; the four equal bins tile the remaining 75 px.
        const waveformLeftEdges = decode_waveform_rect_left_edges(handles, canvas);
        expect(waveformLeftEdges).toHaveLength(4);
        expect(waveformLeftEdges[0]).toBeCloseTo(75);
        expect(waveformLeftEdges[3]).toBeCloseTo(75 + (75 / 4) * 3);
    });

    it('reads no peaks when the pre-roll swallows the whole clip', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());

        // Offset -5 beats against a 4-beat clip: the scheduler starts no
        // source, so there is no audible span to read or draw.
        const base = create_test_model();
        const model: TimelineRenderModel = {
            ...base,
            tracks: [
                {
                    ...base.tracks[0]!,
                    clips: [{ ...base.tracks[0]!.clips[0]!, audioOffsetBeats: -5, stretchRatio: 1 }],
                },
            ],
        };

        renderer.render(model);

        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });

    it('should skip waveform peak reads when the cached audio buffer is missing', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 80;
        install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        renderer.render(create_test_model());

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });

    it('renders MIDI clip notes across the pitch range and submits a draw', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 120;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        const midiModel: TimelineRenderModel = {
            ...create_test_model(),
            tracks: [
                {
                    id: 'midi-track',
                    name: 'MIDI',
                    index: 0,
                    kind: 'midi',
                    color: '#335577',
                    muted: false,
                    soloed: false,
                    height: 120,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'midi-1',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'MIDI Clip',
                            color: '#446688',
                            type: 'midi',
                            muted: false,
                            // Notes span a pitch range so both the min and max
                            // update branches fire; a mid note covers neither.
                            // First note seeds min=max=60; a later lower note
                            // drives the `param < minPitch` branch and a later
                            // higher note the `param > maxPitch` branch.
                            midiNotes: [
                                { id: 'n1', pitch: 60, startBeat: 0, duration: 2 },
                                { id: 'n2', pitch: 72, startBeat: 2, duration: 2 },
                                { id: 'n3', pitch: 48, startBeat: 4, duration: 2 },
                            ],
                            loopEnabled: true,
                            loopLength: 4,
                            midiOffsetBeats: undefined,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(midiModel);

        // A MIDI clip with visible notes must push rects onto the GPU buffer and draw.
        expect(handles.writeBuffer).toHaveBeenCalled();
        expect(handles.draw).toHaveBeenCalled();
    });

    it('completes a render of a dense non-looped clip and a clip narrower than its own margins', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 120;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        // A dense clip: the shared rect budget, not a per-clip note cap, bounds the vertex buffer.
        const manyNotes = Array.from({ length: 400 }, (_, index) => ({
            id: `n${index}`,
            pitch: 60,
            startBeat: index * 0.01,
            duration: 0.01,
        }));
        // A short non-looped clip with few notes: the while-loop reaches the
        // `!loopEnabled` break on its first pass (the cap path short-circuits
        // earlier in the dense clip above, so this clip covers the break).
        const midiModel: TimelineRenderModel = {
            ...create_test_model(),
            tracks: [
                {
                    id: 'midi-track',
                    name: 'MIDI',
                    index: 0,
                    kind: 'midi',
                    color: '#335577',
                    muted: false,
                    soloed: false,
                    height: 120,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'midi-many',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'Dense',
                            color: '#446688',
                            type: 'midi',
                            muted: false,
                            midiNotes: manyNotes,
                            loopEnabled: false,
                            loopLength: 0,
                            midiOffsetBeats: 0,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                        {
                            id: 'midi-sparse',
                            startBeat: 10,
                            endBeat: 10.05,
                            name: 'Sparse',
                            color: '#446688',
                            type: 'midi',
                            muted: false,
                            // A clip narrower than the 2px+2px inner margin
                            // (0.05 beats * 25px/beat = 1.25px < 4px). Any note
                            // inside it has finalX1 = cx1+2 > finalX2 = cx2-2, so
                            // the rect is suppressed (guard at line 396).
                            midiNotes: [{ id: 'sn', pitch: 60, startBeat: 0, duration: 0.001 }],
                            loopEnabled: false,
                            loopLength: 0,
                            midiOffsetBeats: 0,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(midiModel);
        // The renderer must complete the render (draw called) without exhausting the buffer.
        expect(handles.draw).toHaveBeenCalled();
    });

    it('resize updates the canvas backing store and reconfigures the GPU context', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 50;
        install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        renderer.resize(320, 200);

        expect(canvas.width).toBe(320);
        expect(canvas.height).toBe(200);
        expect(canvas.style.width).toBe('320px');
        expect(canvas.style.height).toBe('200px');
    });

    it('resize is a no-op for a zero or negative pixel size', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 50;
        install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }

        renderer.resize(0, 200);
        // Backing store untouched by the zero-size guard.
        expect(canvas.width).toBe(100);
        expect(canvas.height).toBe(50);
    });

    it('resize honours a devicePixelRatio of 0 by falling back to 1', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 50;
        install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 });

        renderer.resize(320, 200);

        expect(canvas.width).toBe(320);
        expect(canvas.height).toBe(200);
    });
});

describe('createWebGpuRenderer render-path branches', () => {
    const base_model = (): TimelineRenderModel => ({
        dataDirty: false,
        tracks: [],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        playheadPosition: 0,
        viewportStartBeat: 0,
        viewportEndBeat: 16,
        beatsPerPixel: 1 / 25,
        pixelsPerBeat: 25,
        trackHeight: 48,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    });

    const make_renderer = async (width = 400, height = 120) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        return { renderer, canvas, handles };
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array());
    });

    it('submits a frame that contains only grid lines when there are no clips', async () => {
        const { renderer, handles } = await make_renderer();
        // No tracks and the playhead offscreen: the only rects produced are the
        // bar/beat grid lines, which always cover beat 0 of the viewport.
        renderer.render({ ...base_model(), playheadPosition: 9999 });
        expect(handles.draw).toHaveBeenCalled();
    });

    it('parses an oklch clip color through the OKLab→sRGB path', async () => {
        const { renderer, handles } = await make_renderer();
        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'midi',
                    color: '',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            // Two oklch clips cover both gamma branches: a bright
                            // warm color (channels well above 0.0031308) and a
                            // near-black color (channels at/below 0.0031308 take
                            // the 12.92*x linear segment of the sRGB curve).
                            color: 'oklch(0.62 0.18 35)',
                            type: 'midi',
                            muted: false,
                            midiNotes: [{ id: 'on', pitch: 60, startBeat: 0, duration: 2 }],
                            loopEnabled: false,
                            midiOffsetBeats: 0,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                        {
                            id: 'c-dark',
                            startBeat: 8,
                            endBeat: 16,
                            name: 'Dark',
                            color: 'oklch(0.002 0 0)',
                            type: 'midi',
                            muted: false,
                            midiNotes: [{ id: 'dn', pitch: 60, startBeat: 0, duration: 2 }],
                            loopEnabled: false,
                            midiOffsetBeats: 0,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        // If the oklch parse produced NaN/garbage the renderer would still run,
        // but the draw completing confirms the color path did not throw.
        expect(handles.draw).toHaveBeenCalled();
    });

    it('falls back to the track color and the default oklch when clip/track colors are empty', async () => {
        const { renderer, handles } = await make_renderer();
        // Empty clip color AND empty track color forces both `||` fallbacks to
        // resolve to the hard-coded oklch default.
        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            color: '',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        expect(handles.draw).toHaveBeenCalled();
    });

    it('parses a 3-character shorthand hex color', async () => {
        const { renderer, handles } = await make_renderer();
        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#abc',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            color: '#abc',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        expect(handles.draw).toHaveBeenCalled();
    });

    it('parses a malformed hex color by falling back to the 0.4 defaults', async () => {
        const { renderer, handles } = await make_renderer();
        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    // Non-hex garbage in every channel slice: parseInt yields NaN
                    // for r/g/b alike, so each resolves to the 0.4 fallback
                    // (the isNaN ternaries on line 80).
                    color: 'zzzzzz',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            color: 'zzzzzz',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        expect(handles.draw).toHaveBeenCalled();
    });

    it('dims a muted clip and highlights a selected clip', async () => {
        const { renderer, handles } = await make_renderer();
        const model: TimelineRenderModel = {
            ...base_model(),
            selectedTrackId: 't',
            selectedClipIds: ['c-sel'],
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#336699',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c-mute',
                            startBeat: 0,
                            endBeat: 4,
                            name: 'Mute',
                            color: '#336699',
                            type: 'audio',
                            muted: true,
                            midiNotes: [],
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                        {
                            id: 'c-sel',
                            startBeat: 4,
                            endBeat: 8,
                            name: 'Sel',
                            color: '#336699',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        // Both clip states must render (draw called once for the whole frame).
        expect(handles.draw).toHaveBeenCalled();
    });

    it('culls clips that fall entirely outside the viewport horizontally', async () => {
        const { renderer, handles } = await make_renderer(400, 120);
        // Viewport is 0..16 beats (0..400px). A clip at beat 100..104 is fully
        // offscreen to the right and is skipped by the cx1 > w cull.
        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#336699',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c-off',
                            startBeat: 100,
                            endBeat: 104,
                            name: 'Off',
                            color: '#336699',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        // Grid lines and playhead still draw, so the frame is submitted even
        // though the clip itself was culled.
        expect(handles.draw).toHaveBeenCalled();
    });

    it('skips audio waveform drawing when the clip is narrower than 4px', async () => {
        const { renderer } = await make_renderer(400, 120);
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());

        // A 0.05-beat clip is ~1.25px wide (< 4px), so the waveform branch's
        // `w >= 4` guard short-circuits and no peaks are read.
        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#336699',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c-thin',
                            startBeat: 0,
                            endBeat: 0.05,
                            name: 'Thin',
                            color: '#336699',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            audioBufferId: 'buf-1',
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });

    it('applies default offset and stretch when the clip omits them', async () => {
        const { renderer } = await make_renderer(400, 120);
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.5, 0.5]));

        // audioOffsetBeats and stretchRatio omitted → the renderer applies the
        // `?? 0` / `?? 1` defaults when computing the sample window.
        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#336699',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            color: '#336699',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            audioBufferId: 'buf-1',
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        // With defaults (offset 0, stretch 1) the sample window starts at 0.
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith(
            expect.objectContaining({ bufferId: 'buf-1', startSample: 0 })
        );
    });

    it('skips waveform bins that resolve to zero amplitude', async () => {
        const { renderer } = await make_renderer(400, 120);
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());
        // A sparse peak array with a leading zero bin (peakHeight <= 0.5 is
        // skipped) followed by a real bin; index access on a Float32Array never
        // yields undefined, so the `?? 0` only fires on a hand-built sparse-like
        // input — here we assert the zero bin draws nothing while a real bin does.
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0, 0.6]));

        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#336699',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            color: '#336699',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            audioBufferId: 'buf-1',
                            audioOffsetBeats: 0,
                            stretchRatio: 1,
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalled();
    });

    it('skips the waveform pass entirely when the cached buffer is absent', async () => {
        const { renderer } = await make_renderer(400, 120);
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#336699',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            color: '#336699',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            audioBufferId: 'buf-1',
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });

    it('draws the playhead when it sits within the viewport', async () => {
        const { renderer, handles } = await make_renderer(400, 120);
        const model: TimelineRenderModel = {
            ...base_model(),
            playheadPosition: 4,
        };

        renderer.render(model);
        expect(handles.draw).toHaveBeenCalled();
    });

    it('renders with a zero devicePixelRatio by falling back to 1', async () => {
        const { renderer, handles } = await make_renderer(400, 120);
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 });

        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#336699',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            color: '#336699',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        expect(handles.draw).toHaveBeenCalled();
    });

    it('is a no-op when the canvas backing store has no area', async () => {
        const { renderer, handles } = await make_renderer(0, 0);
        const model: TimelineRenderModel = {
            ...base_model(),
            playheadPosition: 4,
        };

        renderer.render(model);
        // Zero-sized canvas → render returns before emitting any rects.
        expect(handles.draw).not.toHaveBeenCalled();
    });

    it('reads no waveform bins when the cached peaks array is empty', async () => {
        const { renderer } = await make_renderer(400, 120);
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());
        // Buffer present but peaks empty: the `binsToDraw > 0` guard short-
        // circuits so the per-bin loop never runs.
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array());

        const model: TimelineRenderModel = {
            ...base_model(),
            tracks: [
                {
                    id: 't',
                    name: 'T',
                    index: 0,
                    kind: 'audio',
                    color: '#336699',
                    muted: false,
                    soloed: false,
                    height: 48,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'c',
                            startBeat: 0,
                            endBeat: 8,
                            name: 'C',
                            color: '#336699',
                            type: 'audio',
                            muted: false,
                            midiNotes: [],
                            audioBufferId: 'buf-1',
                            audioOffsetBeats: 0,
                            stretchRatio: 1,
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                        },
                    ],
                },
            ],
        };

        renderer.render(model);
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalled();
    });
});

describe('createWebGpuRenderer factory failure paths', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array());
    });
    afterEach(() => {
        Reflect.deleteProperty(navigator, 'gpu');
        vi.unstubAllGlobals();
    });

    it('returns null when WebGPU is unavailable', async () => {
        Reflect.deleteProperty(navigator, 'gpu');
        const canvas = document.createElement('canvas');
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        expect(renderer).toBeNull();
    });

    it('returns null when no adapter is available', async () => {
        const canvas = document.createElement('canvas');
        Object.defineProperty(navigator, 'gpu', {
            configurable: true,
            value: {
                requestAdapter: vi.fn().mockResolvedValue(null),
                getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
            },
        });
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        expect(renderer).toBeNull();
    });

    it('returns null when the canvas has no webgpu context', async () => {
        const canvas = document.createElement('canvas');
        const device = {
            createShaderModule: vi.fn(),
            createRenderPipeline: vi.fn(),
            createBuffer: vi.fn(() => ({ size: 0, destroy: vi.fn() })),
            createCommandEncoder: vi.fn(),
            destroy: vi.fn(),
            queue: { writeBuffer: vi.fn(), submit: vi.fn() },
        };
        const adapter = { requestDevice: vi.fn().mockResolvedValue(device) };
        Object.defineProperty(navigator, 'gpu', {
            configurable: true,
            value: {
                requestAdapter: vi.fn().mockResolvedValue(adapter),
                getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
            },
        });
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => null),
        });
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        expect(renderer).toBeNull();
    });
});

/**
 * Both timeline renderers must draw the same audio window for the same clip
 * (#2519): the drawn sample span and the leading pre-roll gap are the shared
 * `audioWaveformSpan` law, so any divergence between the Canvas2D and WebGPU
 * paths here is a renderer re-deriving the math on its own. Each case renders
 * the identical clip through `drawClip` and through a full WebGPU frame (dpr 1,
 * so both work in the same pixels) and compares what each asked the peaks
 * cache for and where each started drawing the waveform.
 */
describe('audio waveform span parity across renderers (#2519)', () => {
    /**
     * The Canvas2D context stub drawClip needs; geometry-relevant calls only.
     * `any`-shaped like the sibling clipDrawing.spec stub — a full
     * CanvasRenderingContext2D double would reimplement 46 unused members.
     */
    const create_canvas_2d_stub = (): any => ({
        beginPath: vi.fn(),
        closePath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        arc: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 10 }),
        createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
        fillStyle: '',
        strokeStyle: '',
        font: '',
        globalAlpha: 1,
        lineWidth: 1,
        lineDashOffset: 0,
        shadowColor: '',
        shadowBlur: 0,
        shadowOffsetY: 0,
        setLineDash: vi.fn(),
    });

    /** Render one clip through both renderers; report each one's span and gap. */
    const render_through_both = async (audioOffsetBeats: number, stretchRatio: number) => {
        const base = create_test_model();
        const clip = { ...base.tracks[0]!.clips[0]!, audioOffsetBeats, stretchRatio };
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer(48_000, 480_000));
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.6, 0.6, 0.6, 0.6]));

        // Canvas2D: clip beats 2..6 at 25 px/beat → x = 50, w = 100, inset 2.
        const canvasCtx = create_canvas_2d_stub();
        drawClip(canvasCtx, clip, base, 0, 48);
        const canvasPeaksCall = mocks.getCachedAudioBufferWaveformPeaks.mock.calls.at(-1)![0];
        // The only non-waveform lineTo is the top-edge highlight at y = 2.5.
        const firstWaveformX = canvasCtx.lineTo.mock.calls.find((args: number[]) => args[1] !== 2.5)![0];
        const canvasGapPx = firstWaveformX - (50 + 2);

        // WebGPU, at dpr 1 so its device px are the canvas renderer's CSS px.
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        renderer.render({ ...base, tracks: [{ ...base.tracks[0]!, clips: [clip] }] });
        const gpuPeaksCall = mocks.getCachedAudioBufferWaveformPeaks.mock.calls.at(-1)![0];
        const gpuGapPx = decode_waveform_rect_left_edges(handles, canvas)[0]! - 50;

        return { canvasPeaksCall, canvasGapPx, gpuPeaksCall, gpuGapPx };
    };

    it.each([
        { audioOffsetBeats: 2, stretchRatio: 1, startSample: 48_000, endSample: 144_000, gapPx: 0 },
        { audioOffsetBeats: 0, stretchRatio: 1, startSample: 0, endSample: 96_000, gapPx: 0 },
        { audioOffsetBeats: -0.5, stretchRatio: 1, startSample: 0, endSample: 84_000, gapPx: 12.5 },
        { audioOffsetBeats: -1, stretchRatio: 1, startSample: 0, endSample: 72_000, gapPx: 25 },
        // The pre-roll is the offset span crossed at the clip's rate, so a
        // ratio of 2 halves it (scheduler: preRollSeconds = span / ratio).
        { audioOffsetBeats: -1, stretchRatio: 2, startSample: 0, endSample: 168_000, gapPx: 12.5 },
    ])(
        'offset $audioOffsetBeats (stretch $stretchRatio): span $startSample to $endSample, gap $gapPx px',
        async ({ audioOffsetBeats, stretchRatio, startSample, endSample, gapPx }) => {
            const { canvasPeaksCall, canvasGapPx, gpuPeaksCall, gpuGapPx } = await render_through_both(
                audioOffsetBeats,
                stretchRatio
            );

            expect(canvasPeaksCall.startSample).toBe(startSample);
            expect(canvasPeaksCall.endSample).toBe(endSample);
            expect(gpuPeaksCall.startSample).toBe(startSample);
            expect(gpuPeaksCall.endSample).toBe(endSample);
            expect(canvasGapPx).toBeCloseTo(gapPx);
            expect(gpuGapPx).toBeCloseTo(gapPx);
        }
    );

    it('both renderers decline to draw when the pre-roll swallows the clip', async () => {
        const base = create_test_model();
        const clip = { ...base.tracks[0]!.clips[0]!, audioOffsetBeats: -5, stretchRatio: 1 };
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());

        drawClip(create_canvas_2d_stub(), clip, base, 0, 48);
        const canvasReads = mocks.getCachedAudioBufferWaveformPeaks.mock.calls.length;

        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        renderer.render({ ...base, tracks: [{ ...base.tracks[0]!, clips: [clip] }] });

        expect(canvasReads).toBe(0);
        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });
});

describe('createWebGpuRenderer MIDI notes follow the shared geometry law', () => {
    const NOTE_ALPHA_INLINE = 0.8;
    const NOTE_ALPHA_PREVIEW = 0.22;
    const GRID_LINE_ALPHA = 0.05;
    const BACKDROP_ALPHA = 0.2;
    const TRACK_HEIGHT = 80;

    type MidiClipOptions = Partial<TimelineRenderModel['tracks'][number]['clips'][number]> & {
        notes: Array<{ id: string; pitch: number; startBeat: number; duration: number }>;
    };

    const midi_model = (options: MidiClipOptions, view: Partial<TimelineRenderModel> = {}): TimelineRenderModel => {
        const { notes, ...clipOptions } = options;
        return {
            ...create_test_model(),
            ...view,
            tracks: [
                {
                    id: 'midi-track',
                    name: 'MIDI',
                    index: 0,
                    kind: 'midi',
                    color: '#335577',
                    muted: false,
                    soloed: false,
                    height: TRACK_HEIGHT,
                    automationMode: 'read',
                    clips: [
                        {
                            id: 'midi-1',
                            startBeat: 2,
                            endBeat: 10,
                            name: 'MIDI Clip',
                            color: '#446688',
                            type: 'midi',
                            muted: false,
                            midiNotes: notes,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            ...clipOptions,
                        },
                    ],
                },
            ],
        };
    };

    const render_midi = async (model: TimelineRenderModel): Promise<DecodedRect[]> => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 120;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        renderer.render(model);
        return decode_rects(handles, canvas);
    };

    const with_alpha = (rects: DecodedRect[], alpha: number): DecodedRect[] =>
        rects.filter((rect) => Math.abs(rect.alpha - alpha) < 1e-6);

    it('draws a lone pitch-71 note inline in the row the law assigns 71, the top row', async () => {
        const clip: InlineMidiGeometryClip = {
            startBeat: 2,
            endBeat: 10,
            midiNotes: [{ id: 'n1', pitch: 71, startBeat: 0, duration: 2 }],
        };
        const frame = resolveMidiClipFrame(true, 2 * 25, 8 * 25, 0, TRACK_HEIGHT);
        const pitch_window = resolveMidiPitchWindow(clip.midiNotes, true, frame.contentHeight);
        let law_y = NaN;
        forEachMidiNoteRect(clip, frame, pitch_window, { inline: true }, (_note, _x, y) => {
            law_y = y;
        });

        const notes = with_alpha(
            await render_midi(midi_model({ isInlineEditing: true, notes: clip.midiNotes })),
            NOTE_ALPHA_INLINE
        );

        // Pitch 71 tops the 60..71 window: the first row, not the bottom one.
        expect(notes).toHaveLength(1);
        expect(notes[0]!.y1).toBeCloseTo(law_y, 3);
        expect(notes[0]!.y1).toBeCloseTo(frame.contentTop, 3);
        expect(notes[0]!.y2).toBeLessThan(frame.contentTop + pitch_window.rowHeight);
        expect(notes[0]!.x1).toBeCloseTo(2 * 25, 3);
    });

    it('places notes of an inline clip off the grid start, offset and loop repeats the way the law does', async () => {
        const clip: InlineMidiGeometryClip = {
            startBeat: 2,
            endBeat: 10,
            midiOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 3,
            midiNotes: [
                { id: 'a', pitch: 64, startBeat: 1.5, duration: 1 },
                { id: 'b', pitch: 55, startBeat: 2.5, duration: 0.5 },
            ],
        };
        const frame = resolveMidiClipFrame(true, 2 * 25, 8 * 25, 0, TRACK_HEIGHT);
        const pitch_window = resolveMidiPitchWindow(clip.midiNotes, true, frame.contentHeight);
        const expected: Array<[number, number, number]> = [];
        forEachMidiNoteRect(clip, frame, pitch_window, { inline: true }, (_note, x, y, width) => {
            expected.push([x, y, width]);
        });

        const { notes: _unused, ...timing } = clip;
        const notes = with_alpha(
            await render_midi(midi_model({ ...timing, isInlineEditing: true, notes: clip.midiNotes })),
            NOTE_ALPHA_INLINE
        );

        expect(expected).toHaveLength(6);
        expect(notes.map((rect) => [rect.x1, rect.y1, rect.x2 - rect.x1])).toEqual(
            expected.map(([x, y, width]) => [expect.closeTo(x, 3), expect.closeTo(y, 3), expect.closeTo(width, 3)])
        );
    });

    it('draws the pitch grid for an inline clip with no notes', async () => {
        const rects = await render_midi(midi_model({ isInlineEditing: true, notes: [] }));
        const frame = resolveMidiClipFrame(true, 2 * 25, 8 * 25, 0, TRACK_HEIGHT);

        const backdrop = with_alpha(rects, BACKDROP_ALPHA);
        expect(backdrop).toHaveLength(1);
        expect(backdrop[0]!.y1).toBeCloseTo(frame.contentTop, 3);
        expect(backdrop[0]!.y2).toBeCloseTo(frame.contentTop + frame.contentHeight, 3);
        // The octave from middle C is twelve rows, ruled by thirteen lines.
        expect(with_alpha(rects, GRID_LINE_ALPHA)).toHaveLength(13);
    });

    it('draws no grid for a non-inline clip with no notes', async () => {
        const rects = await render_midi(midi_model({ notes: [] }));

        expect(with_alpha(rects, BACKDROP_ALPHA)).toHaveLength(0);
        expect(with_alpha(rects, GRID_LINE_ALPHA)).toHaveLength(0);
    });

    it('places a non-inline preview note where the law puts it', async () => {
        const clip: InlineMidiGeometryClip = {
            startBeat: 2,
            endBeat: 10,
            midiNotes: [
                { id: 'lo', pitch: 50, startBeat: 0, duration: 1 },
                { id: 'hi', pitch: 70, startBeat: 1, duration: 1 },
            ],
        };
        const frame = resolveMidiClipFrame(false, 2 * 25, 8 * 25, 0, TRACK_HEIGHT);
        const pitch_window = resolveMidiPitchWindow(clip.midiNotes, false, frame.contentHeight);
        const expected: Array<[number, number]> = [];
        forEachMidiNoteRect(clip, frame, pitch_window, { inline: false }, (_note, x, y) => {
            expected.push([x, y]);
        });

        const notes = with_alpha(await render_midi(midi_model({ notes: clip.midiNotes })), NOTE_ALPHA_PREVIEW);

        expect(notes.map((rect) => [rect.x1, rect.y1])).toEqual(
            expected.map(([x, y]) => [expect.closeTo(x, 3), expect.closeTo(y, 3)])
        );
    });

    it('draws every note of a dense inline clip rather than the first 300', async () => {
        const notes = Array.from({ length: 400 }, (_unused, index) => ({
            id: `n${index}`,
            pitch: 60 + (index % 12),
            startBeat: index * 0.02,
            duration: 0.02,
        }));

        const rects = await render_midi(midi_model({ isInlineEditing: true, notes }));

        expect(with_alpha(rects, NOTE_ALPHA_INLINE)).toHaveLength(400);
    });

    it('draws the loop repeats in view of a long clip, past the hundredth', async () => {
        const model = midi_model(
            {
                startBeat: 0,
                endBeat: 128,
                isInlineEditing: true,
                loopEnabled: true,
                loopLength: 1,
                notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5 }],
            },
            { viewportStartBeat: 118, viewportEndBeat: 126 }
        );

        const rects = with_alpha(await render_midi(model), NOTE_ALPHA_INLINE);

        // One bar per repeat in view, the one starting on the right edge included: pass k starts k beats in, at (k - 118) * 25 px.
        expect(rects).toHaveLength(9);
        expect(rects.map((rect) => rect.x1)).toEqual(
            [118, 119, 120, 121, 122, 123, 124, 125, 126].map((beat) => expect.closeTo((beat - 118) * 25, 3))
        );
    });
});
