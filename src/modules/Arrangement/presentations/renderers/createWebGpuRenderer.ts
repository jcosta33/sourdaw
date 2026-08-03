import { getCachedAudioBuffer, getCachedAudioBufferWaveformPeaks } from '#/modules/AudioEngine/useCases';
import { resolveToken } from '#/utils/UI/resolveToken';

import { type TimelineRenderer } from '../../models/RendererBackend';
import { type TimelineRenderModel } from '../../models/TimelineRenderModel';

import { CLIP_LABEL_BLOCK_HEIGHT_CSS_PX, computeClipLabelLayout } from './clipLabel';
import { createClipLabelTextureCache } from './createClipLabelTextureCache';

// ─── WGSL shaders ────────────────────────────────────────────────────────────
// Each vertex carries: xy (NDC) + rgba (f32 × 4) = 6 floats = 24 bytes
const WGSL_SHADER = /* wgsl */ `
struct VertexOut {
    @builtin(position) pos : vec4f,
    @location(0)       col : vec4f,
}

@vertex
fn vs_main(
    @location(0) xy : vec2f,
    @location(1) col: vec4f,
) -> VertexOut {
    var out : VertexOut;
    out.pos = vec4f(xy, 0.0, 1.0);
    out.col = col;
    return out;
}

@fragment
fn fs_main(@location(0) col: vec4f) -> @location(0) vec4f {
    return col;
}
`;

// Textured-quad shader for clip name labels. Each vertex carries xy (NDC) + uv.
const WGSL_TEXT_SHADER = /* wgsl */ `
struct TextVertexOut {
    @builtin(position) pos : vec4f,
    @location(0)       uv  : vec2f,
}

@group(0) @binding(0) var label_sampler : sampler;
@group(0) @binding(1) var label_texture : texture_2d<f32>;

@vertex
fn vs_text(
    @location(0) xy : vec2f,
    @location(1) uv : vec2f,
) -> TextVertexOut {
    var out : TextVertexOut;
    out.pos = vec4f(xy, 0.0, 1.0);
    out.uv = uv;
    return out;
}

@fragment
fn fs_text(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSample(label_texture, label_sampler, uv);
}
`;

// Floats per vertex: xy (2) + rgba (4) = 6
const FLOATS_PER_VERTEX = 6;
// 2 triangles per rect = 6 vertices
const VERTICES_PER_RECT = 6;
const FLOATS_PER_RECT = VERTICES_PER_RECT * FLOATS_PER_VERTEX;
// Upper bound: many tracks × many clips + track rows + playhead + bar lines, now + waveform rects
const MAX_RECTS = 32768;

// Floats per text vertex: xy (2) + uv (2) = 4
const FLOATS_PER_TEXT_VERTEX = 4;
const FLOATS_PER_TEXT_QUAD = VERTICES_PER_RECT * FLOATS_PER_TEXT_VERTEX;
// One quad per visible clip label.
const MAX_LABELS = 512;

// ─── Colour helpers ───────────────────────────────────────────────────────────
/** Parse hex (#rrggbb / #rgb) OR oklch(L C H) into [r, g, b, a] with values in 0..1 */
function colorToRgba(color: string, alpha = 1): [number, number, number, number] {
    // oklch(L C H) → OKLab → linear sRGB → sRGB
    const oklchMatch = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
    if (oklchMatch) {
        const L = parseFloat(oklchMatch[1]!);
        const C = parseFloat(oklchMatch[2]!);
        const H = parseFloat(oklchMatch[3]!) * (Math.PI / 180);
        const a_ = C * Math.cos(H);
        const b_ = C * Math.sin(H);
        // OKLab → linear sRGB (approximate via LMS)
        const l_ = L + 0.3963377774 * a_ + 0.2158037573 * b_;
        const m_ = L - 0.1055613458 * a_ - 0.0638541728 * b_;
        const s_ = L - 0.0894841775 * a_ - 1.291485548 * b_;
        const l3 = l_ * l_ * l_;
        const m3 = m_ * m_ * m_;
        const s3 = s_ * s_ * s_;
        const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
        const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
        const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
        // Linear → sRGB gamma, clamped to [0,1]
        const gamma = (x: number): number => {
            const value = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
            return Math.max(0, Math.min(1, value));
        };
        return [gamma(lr), gamma(lg), gamma(lb), alpha];
    }

    // Hex fallback
    const clean = color.replace('#', '');
    if (clean.length === 3) {
        const r = parseInt(clean[0]! + clean[0]!, 16) / 255;
        const gain = parseInt(clean[1]! + clean[1]!, 16) / 255;
        const buffer = parseInt(clean[2]! + clean[2]!, 16) / 255;
        return [r, gain, buffer, alpha];
    }
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const gain = parseInt(clean.slice(2, 4), 16) / 255;
    const buffer = parseInt(clean.slice(4, 6), 16) / 255;
    return [isNaN(r) ? 0.4 : r, isNaN(gain) ? 0.4 : gain, isNaN(buffer) ? 0.4 : buffer, alpha];
}

// ─── MIDI note geometry (pure) ────────────────────────────────────────────────
/** Clip-relative beat span of a single MIDI note occurrence within a clip. */
export type MidiNoteBeatSpan = {
    /** Beat of the note's onset, relative to the clip's start (0 = clip start). */
    relStartBeat: number;
    /** Beat of the note's tail, relative to the clip's start. */
    relEndBeat: number;
    /** False when the occurrence falls entirely outside the clip window. */
    visible: boolean;
};

/**
 * Compute a MIDI note occurrence's clip-relative beat span.
 *
 * `note.startBeat` is already clip-relative (0 = the clip's left edge) — the
 * same convention the Canvas renderer (`clipDrawing.ts`), the render-model
 * builder (`buildTimelineRenderModel.ts`), and the playback scheduler
 * (`scheduleMidiNotes.ts`, which adds `clip.startBeat` only at schedule time)
 * all use. `midiOffset` (clip.midiOffsetBeats) shifts which slice of the MIDI
 * content the clip window reveals; `loopOffset` advances each loop repetition.
 *
 * Pure and side-effect-free so the coordinate math is unit-testable without a
 * GPU device (a full WebGPU render is not exercisable under vitest/jsdom).
 */
export function computeMidiNoteBeatSpan(
    note: { startBeat: number; duration: number },
    midiOffset: number,
    loopOffset: number,
    clipDuration: number
): MidiNoteBeatSpan {
    const relStartBeat = note.startBeat - midiOffset + loopOffset;
    const relEndBeat = relStartBeat + Math.max(note.duration, 0.125);
    const visible = relEndBeat > 0 && relStartBeat < clipDuration;
    return { relStartBeat, relEndBeat, visible };
}

// ─── Geometry helper ──────────────────────────────────────────────────────────
/**
 * Push a screen-space rectangle into the Float32Array vertex buffer.
 * Coordinates are in pixels; we convert to NDC using canvas dimensions.
 */
function pushRect(
    buf: Float32Array,
    offset: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    gain: number,
    buffer: number,
    alpha: number,
    w: number,
    h: number
): number {
    // Convert pixel coords → NDC (WebGPU: Y+ is up)
    const nx1 = (x1 / w) * 2 - 1;
    const nx2 = (x2 / w) * 2 - 1;
    const ny1 = 1 - (y1 / h) * 2;
    const ny2 = 1 - (y2 / h) * 2;

    // Triangle 1: top-left, top-right, bottom-left
    // Triangle 2: top-right, bottom-right, bottom-left
    const verts: number[] = [
        nx1,
        ny1,
        r,
        gain,
        buffer,
        alpha,
        nx2,
        ny1,
        r,
        gain,
        buffer,
        alpha,
        nx1,
        ny2,
        r,
        gain,
        buffer,
        alpha,
        nx2,
        ny1,
        r,
        gain,
        buffer,
        alpha,
        nx2,
        ny2,
        r,
        gain,
        buffer,
        alpha,
        nx1,
        ny2,
        r,
        gain,
        buffer,
        alpha,
    ];
    buf.set(verts, offset);
    return offset + FLOATS_PER_RECT;
}

/**
 * Push a screen-space textured quad (xy + uv per vertex) covering the whole
 * source texture. Winding matches `pushRect` so both pipelines agree.
 */
function pushTexturedQuad(
    buf: Float32Array,
    offset: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w: number,
    h: number
): number {
    const nx1 = (x1 / w) * 2 - 1;
    const nx2 = (x2 / w) * 2 - 1;
    const ny1 = 1 - (y1 / h) * 2;
    const ny2 = 1 - (y2 / h) * 2;

    // prettier-ignore
    const verts: number[] = [
        nx1, ny1, 0, 0,
        nx2, ny1, 1, 0,
        nx1, ny2, 0, 1,
        nx2, ny1, 1, 0,
        nx2, ny2, 1, 1,
        nx1, ny2, 0, 1,
    ];
    buf.set(verts, offset);
    return offset + FLOATS_PER_TEXT_QUAD;
}

// ─── Main factory ─────────────────────────────────────────────────────────────
export async function createWebGpuRenderer(canvas: HTMLCanvasElement): Promise<TimelineRenderer | null> {
    if (!navigator.gpu) {
        return null;
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return null;
        }

        const device = await adapter.requestDevice();
        const gpuContext = canvas.getContext('webgpu');
        if (!gpuContext) {
            return null;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        gpuContext.configure({ device, format, alphaMode: 'premultiplied' });

        // ─── Shader & pipeline ────────────────────────────────────────────
        const shaderModule = device.createShaderModule({ code: WGSL_SHADER });

        const pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: FLOATS_PER_VERTEX * 4, // bytes
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // xy
                            { shaderLocation: 1, offset: 2 * 4, format: 'float32x4' }, // rgba
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [
                    {
                        format,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        },
                    },
                ],
            },
            primitive: { topology: 'triangle-list' },
        });

        // ─── Clip label (text) pipeline ───────────────────────────────────
        // WebGPU draws no text of its own; labels are rasterised to an
        // OffscreenCanvas 2D context, uploaded as textures and composited here
        // as one quad each. Alpha is premultiplied by the upload, so the source
        // factor is `one` rather than `src-alpha`.
        const textShaderModule = device.createShaderModule({ code: WGSL_TEXT_SHADER });
        const textPipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: textShaderModule,
                entryPoint: 'vs_text',
                buffers: [
                    {
                        arrayStride: FLOATS_PER_TEXT_VERTEX * 4,
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // xy
                            { shaderLocation: 1, offset: 2 * 4, format: 'float32x2' }, // uv
                        ],
                    },
                ],
            },
            fragment: {
                module: textShaderModule,
                entryPoint: 'fs_text',
                targets: [
                    {
                        format,
                        blend: {
                            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        },
                    },
                ],
            },
            primitive: { topology: 'triangle-list' },
        });

        const labelSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        const labelCache = createClipLabelTextureCache({
            device,
            bindGroupLayout: textPipeline.getBindGroupLayout(0),
            sampler: labelSampler,
        });

        // ─── Vertex buffer (CPU-mapped every frame) ───────────────────────
        const maxBytes = MAX_RECTS * FLOATS_PER_RECT * 4;
        const cpuBuf = new Float32Array(MAX_RECTS * FLOATS_PER_RECT);

        let gpuBuf = device.createBuffer({
            size: maxBytes,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        const textCpuBuf = new Float32Array(MAX_LABELS * FLOATS_PER_TEXT_QUAD);
        const textGpuBuf = device.createBuffer({
            size: MAX_LABELS * FLOATS_PER_TEXT_QUAD * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        let canvasW = canvas.width;
        let canvasH = canvas.height;

        // ─── Per-frame render ─────────────────────────────────────────────
        function render(model: TimelineRenderModel): void {
            const w = canvasW;
            const h = canvasH;
            if (w <= 0 || h <= 0) {
                return;
            }
            const dpr = window.devicePixelRatio || 1;

            // Viewport beat range → pixel helpers
            const { viewportStartBeat, pixelsPerBeat, scrollY, selectedClipIds, selectedTrackId, playheadPosition } =
                model;

            function beatToX(beat: number): number {
                return (beat - viewportStartBeat) * pixelsPerBeat * dpr;
            }

            let offset = 0;
            let rectCount = 0;

            // Clip name labels, collected during the clip pass and composited
            // after every rect so they sit on top of the clip body.
            let textOffset = 0;
            const labelBindGroups: GPUBindGroup[] = [];

            function addClipLabel(text: string, clipX: number, clipRight: number, trackTop: number): void {
                if (labelBindGroups.length >= MAX_LABELS) {
                    return;
                }
                // The shared layout works in CSS px; the render loop works in
                // device px, so divide out the dpr on the way in.
                const layout = computeClipLabelLayout({
                    clipXCssPx: clipX / dpr,
                    clipWidthCssPx: (clipRight - clipX) / dpr,
                    trackYCssPx: trackTop / dpr,
                });
                if (!layout.visible) {
                    return;
                }

                const label = labelCache.acquire({ text, maxWidthCssPx: layout.maxWidthCssPx, dpr });
                if (!label) {
                    return;
                }

                const x1 = layout.xCssPx * dpr;
                const y1 = layout.blockTopYCssPx * dpr;
                textOffset = pushTexturedQuad(
                    textCpuBuf,
                    textOffset,
                    x1,
                    y1,
                    // The raster is sized to the glyph run, not to the clip, so
                    // the quad has to be too — using the clip's width here would
                    // stretch a short name across the whole clip.
                    x1 + label.widthCssPx * dpr,
                    y1 + CLIP_LABEL_BLOCK_HEIGHT_CSS_PX * dpr,
                    w,
                    h
                );
                labelBindGroups.push(label.bindGroup);
            }

            function addRect(x1: number, y1: number, x2: number, y2: number, color: string, alpha = 1): void {
                if (rectCount >= MAX_RECTS) {
                    return;
                }
                const [r, gain, buffer1] = colorToRgba(color, alpha);
                offset = pushRect(cpuBuf, offset, x1, y1, x2, y2, r, gain, buffer1, alpha, w, h);
                rectCount++;
            }

            // 1. Track background rows
            let trackY = -scrollY * dpr;
            for (const track of model.tracks) {
                const th = track.height * dpr;
                const isSelected = track.id === selectedTrackId;
                const bg = isSelected
                    ? resolveToken('--color-bg-well', '#0d0d0d')
                    : resolveToken('--color-bg-tray', '#0a0a0a');
                addRect(0, trackY, w, trackY + th, bg);
                // Row separator line
                addRect(0, trackY + th - dpr, w, trackY + th, '#000000', 0.6);
                trackY += th;
            }

            // 2. Clips
            trackY = -scrollY * dpr;
            for (const track of model.tracks) {
                const th = track.height * dpr;
                const clipTop = trackY + 2 * dpr;
                const clipBottom = trackY + th - 2 * dpr;

                for (const clip of track.clips) {
                    const cx1 = beatToX(clip.startBeat);
                    const cx2 = beatToX(clip.endBeat);
                    if (cx2 < 0 || cx1 > w) {
                        continue;
                    }
                    const isSelected = selectedClipIds.includes(clip.id);
                    const alpha = clip.muted ? 0.35 : 1.0;

                    // Clip body
                    const color = clip.color || track.color || 'oklch(0.40 0.08 250)';
                    addRect(cx1, clipTop, cx2, clipBottom, color, alpha * 1);

                    // Clip top accent stripe
                    addRect(cx1, clipTop, cx2, clipTop + 3 * dpr, color, alpha);

                    // Selection highlight — warm metallic border + inner brightening
                    if (isSelected) {
                        // Inner brightening overlay to make clip pop
                        addRect(cx1, clipTop, cx2, clipBottom, '#ffffff', 0.06);
                        // Warm metallic border (2px, high alpha)
                        const bw = 2 * dpr;
                        addRect(cx1, clipTop, cx2, clipTop + bw, 'oklch(0.62 0.05 55)', 0.75);
                        addRect(cx1, clipTop, cx1 + bw, clipBottom, 'oklch(0.62 0.05 55)', 0.75);
                        addRect(cx2 - bw, clipTop, cx2, clipBottom, 'oklch(0.62 0.05 55)', 0.75);
                        addRect(cx1, clipBottom - bw, cx2, clipBottom, 'oklch(0.62 0.05 55)', 0.75);
                    }

                    // MIDI mini-notes
                    if (clip.type === 'midi' && clip.midiNotes.length > 0) {
                        // §70.3 — Single-pass min/max without allocating a
                        // pitches[] or spreading into Math.min/.max. Per-frame
                        // per-clip hot path; MIDI clips can have thousands of
                        // notes and Math.max(...arr) would stack-overflow on
                        // large spreads.
                        let minPitch = clip.midiNotes[0]!.pitch;
                        let maxPitch = minPitch;
                        for (let index = 1; index < clip.midiNotes.length; index++) {
                            const param = clip.midiNotes[index]!.pitch;
                            if (param < minPitch) {
                                minPitch = param;
                            } else if (param > maxPitch) {
                                maxPitch = param;
                            }
                        }
                        const pitchRange = Math.max(maxPitch - minPitch, 12);
                        const noteAreaH = clipBottom - clipTop - 10 * dpr;

                        const clipDuration = clip.endBeat - clip.startBeat;
                        const loopLen = clip.loopEnabled && clip.loopLength ? clip.loopLength : clipDuration;
                        const midiOffset = clip.midiOffsetBeats ?? 0;

                        let loopOffset = 0;
                        let drawnNotes = 0;
                        const MAX_NOTES_PER_CLIP = 300;

                        while (loopOffset < clipDuration) {
                            for (const note of clip.midiNotes) {
                                if (drawnNotes >= MAX_NOTES_PER_CLIP) {
                                    break;
                                }

                                // note.startBeat is clip-relative (0 = clip
                                // start); midiOffset shifts the revealed slice
                                // and loopOffset advances each loop repeat.
                                const { relStartBeat, relEndBeat, visible } = computeMidiNoteBeatSpan(
                                    note,
                                    midiOffset,
                                    loopOffset,
                                    clipDuration
                                );
                                if (!visible) {
                                    continue;
                                }

                                const nx1 = beatToX(clip.startBeat + relStartBeat);
                                const nx2 = beatToX(clip.startBeat + relEndBeat);
                                if (nx2 < cx1 || nx1 > cx2) {
                                    continue;
                                }
                                const noteY = clipBottom - 5 * dpr - ((note.pitch - minPitch) / pitchRange) * noteAreaH;
                                const finalX1 = Math.max(nx1, cx1 + 2);
                                const finalX2 = Math.min(nx2, cx2 - 2);
                                if (finalX1 < finalX2) {
                                    addRect(finalX1, noteY - dpr, finalX2, noteY + 2 * dpr, '#ffffff', alpha * 0.35);
                                }
                                drawnNotes++;
                            }
                            if (drawnNotes >= MAX_NOTES_PER_CLIP) {
                                break;
                            }
                            loopOffset += loopLen;
                            if (!clip.loopEnabled || loopLen <= 0) {
                                break;
                            }
                        }
                    }

                    // AUDIO waveform peaks
                    if (clip.type === 'audio' && clip.audioBufferId) {
                        const w = cx2 - cx1;
                        if (w >= 4) {
                            // At least 1 rect per pixel, up to max ~2000 bins to balance perf
                            const numBins = Math.min(Math.floor(w * dpr), 2000);

                            const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
                            if (buffer) {
                                const offsetBeats = clip.audioOffsetBeats ?? 0;
                                const stretchRatio = clip.stretchRatio ?? 1;
                                const clipBeats = clip.endBeat - clip.startBeat;
                                const secondsPerBeat = 60 / model.tempo;
                                const sampleRate = buffer.sampleRate;
                                const startSample = Math.max(0, Math.floor(offsetBeats * secondsPerBeat * sampleRate));
                                const beatsConsumed = clipBeats / Math.max(stretchRatio, 0.0001);
                                const endSample = Math.floor(startSample + beatsConsumed * secondsPerBeat * sampleRate);

                                const peaks = getCachedAudioBufferWaveformPeaks({
                                    bufferId: clip.audioBufferId,
                                    numBins,
                                    startSample,
                                    endSample,
                                });

                                const midY = clipTop + (clipBottom - clipTop) / 2;
                                const padding = 2 * dpr;
                                const amplitude = (clipBottom - clipTop - padding * 2) * 0.35;

                                // White with transparency — matches MIDI note style
                                const wfColor = '#ffffff';

                                const binsToDraw = peaks.length;
                                if (binsToDraw > 0) {
                                    const drawBinWidth = w / binsToDraw;

                                    for (let index = 0; index < binsToDraw; index++) {
                                        const peakHeight = (peaks[index] ?? 0) * amplitude;
                                        if (peakHeight > 0.5) {
                                            const bx1 = cx1 + index * drawBinWidth;
                                            const bx2 = bx1 + drawBinWidth;
                                            addRect(
                                                bx1,
                                                midY - peakHeight,
                                                bx2,
                                                midY + peakHeight,
                                                wfColor,
                                                alpha * 0.18
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Clip name. Placed from the layout the Canvas2D renderer
                    // also uses, so switching backends loses no information.
                    addClipLabel(clip.name, cx1, cx2, trackY);
                }
                trackY += track.height * dpr;
            }

            // 3. Bar / beat grid lines
            const barBeats = model.timeSignatureNumerator;
            const firstBar = Math.floor(viewportStartBeat / barBeats);
            const lastBar = Math.ceil((viewportStartBeat + w / pixelsPerBeat / dpr) / barBeats) + 1;
            for (let bar = firstBar; bar <= lastBar; bar++) {
                const beat = bar * barBeats;
                const gx = beatToX(beat);
                if (gx < 0 || gx > w) {
                    continue;
                }
                addRect(gx, 0, gx + dpr, h, '#ffffff', bar % 4 === 0 ? 0.08 : 0.04);
            }

            // 4. Playhead
            const phX = beatToX(playheadPosition);
            if (phX >= 0 && phX <= w) {
                addRect(phX - dpr, 0, phX + dpr, h, resolveToken('--color-state-record', '#c45040'), 0.9); // red needle
                addRect(
                    phX - 4 * dpr,
                    0,
                    phX + 4 * dpr,
                    12 * dpr,
                    resolveToken('--color-state-record', '#c45040'),
                    0.9
                ); // head cap
            }

            if (rectCount === 0) {
                return;
            }

            // Upload vertex data
            device.queue.writeBuffer(gpuBuf, 0, cpuBuf, 0, rectCount * FLOATS_PER_RECT);
            if (labelBindGroups.length > 0) {
                device.queue.writeBuffer(textGpuBuf, 0, textCpuBuf, 0, labelBindGroups.length * FLOATS_PER_TEXT_QUAD);
            }

            // Record + submit
            const encoder = device.createCommandEncoder();
            const textureView = gpuContext!.getCurrentTexture().createView();
            const renderPass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: textureView,
                        clearValue: { r: 0.07, g: 0.07, b: 0.07, a: 1.0 },
                        loadOp: 'clear' as GPULoadOp,
                        storeOp: 'store' as GPUStoreOp,
                    },
                ],
            });

            renderPass.setPipeline(pipeline);
            renderPass.setVertexBuffer(0, gpuBuf);
            renderPass.draw(rectCount * VERTICES_PER_RECT);

            // Clip names last, so they sit above every clip body and overlay.
            if (labelBindGroups.length > 0) {
                renderPass.setPipeline(textPipeline);
                renderPass.setVertexBuffer(0, textGpuBuf);
                let labelIndex = 0;
                for (const bindGroup of labelBindGroups) {
                    renderPass.setBindGroup(0, bindGroup);
                    renderPass.draw(VERTICES_PER_RECT, 1, labelIndex * VERTICES_PER_RECT);
                    labelIndex++;
                }
            }

            renderPass.end();
            device.queue.submit([encoder.finish()]);
        }

        function resize(w: number, h: number): void {
            const dpr = window.devicePixelRatio || 1;
            const pw = Math.round(w * dpr);
            const ph = Math.round(h * dpr);
            if (pw <= 0 || ph <= 0) {
                return;
            }
            canvasW = pw;
            canvasH = ph;
            canvas.width = pw;
            canvas.height = ph;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            gpuContext!.configure({ device, format, alphaMode: 'premultiplied' });

            // Recreate GPU buffer if sizing up
            const needed = MAX_RECTS * FLOATS_PER_RECT * 4;
            if (gpuBuf.size < needed) {
                gpuBuf.destroy();
                gpuBuf = device.createBuffer({
                    size: needed,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                });
            }
        }

        function dispose(): void {
            labelCache.dispose();
            textGpuBuf.destroy();
            gpuBuf.destroy();
            device.destroy();
        }

        return { backend: 'webgpu', render, resize, dispose };
    } catch {
        return null;
    }
}
